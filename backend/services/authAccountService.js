const bcrypt = require('bcryptjs');
const { queryAll, queryOne, runSql } = require('../database');
const otpService = require('../otpService');
const authAudit = require('./authAudit');

async function registerJoueur(db, body, { ip = null } = {}) {
  const { prenom, nom, telephone, password, email } = body || {};
  if (!otpService.isValidSenegalMobile(telephone)) {
    const error = new Error('Numéro invalide. Format attendu : 7X XXX XX XX');
    error.statusCode = 400;
    throw error;
  }

  const phoneDigits = otpService.normalizeTelephone(telephone);
  const prenomClean = String(prenom || '').trim();
  const nomClean = String(nom || '').trim();

  const existingPhone = queryAll(db, 'SELECT id, telephone, telephone_verified, role FROM users').find(
    (u) => otpService.normalizeTelephone(u.telephone) === phoneDigits,
  );
  if (existingPhone && Number(existingPhone.telephone_verified) === 1) {
    const error = new Error('Ce numéro est déjà utilisé');
    error.statusCode = 409;
    throw error;
  }

  const passwordHash = bcrypt.hashSync(password, 12);
  const generatedEmail = email || `joueur-${phoneDigits}@terrainsn.local`;

  let userId;
  if (existingPhone && Number(existingPhone.telephone_verified) !== 1) {
    runSql(
      db,
      `UPDATE users SET nom = ?, prenom = ?, password_hash = ?, email = ?, role = 'joueur', is_active = 1, telephone_verified = 0
       WHERE id = ?`,
      [nomClean || null, prenomClean || null, passwordHash, generatedEmail, existingPhone.id],
    );
    userId = existingPhone.id;
  } else {
    const existingEmail = queryOne(db, 'SELECT id FROM users WHERE email = ?', [generatedEmail]);
    if (existingEmail) {
      const error = new Error('Compte déjà existant');
      error.statusCode = 409;
      throw error;
    }
    const result = runSql(
      db,
      `INSERT INTO users (nom, prenom, email, password_hash, telephone, role, is_active, telephone_verified)
       VALUES (?, ?, ?, ?, ?, 'joueur', 1, 0)`,
      [nomClean || null, prenomClean || null, generatedEmail, passwordHash, otpService.formatDisplayPhone(phoneDigits)],
    );
    userId = result.lastInsertRowid;
  }

  await otpService.createAndSendOtp(db, { telephone: phoneDigits, userId, prenom: prenomClean });
  authAudit.ecrire(db, { userId, action: 'register', telephone: phoneDigits, ip });

  return {
    status: 201,
    payload: {
      success: true,
      message: 'Code envoyé',
      telephone: otpService.formatDisplayPhone(phoneDigits),
    },
    userId,
  };
}

async function verifyOtpJoueur(db, { telephone, code }, { ip = null } = {}) {
  const found = otpService.findValidOtp(db, telephone, code);
  if (found.error) {
    authAudit.ecrire(db, { action: 'verify_echec', telephone, ip, meta: { raison: 'otp' } });
    return { status: 400, payload: { error: found.error } };
  }

  const { otp, telephoneDigits } = found;
  const user = queryAll(db, 'SELECT id, nom, prenom, email, telephone, role, telephone_verified FROM users')
    .find((u) => otpService.normalizeTelephone(u.telephone) === telephoneDigits);

  if (!user) {
    authAudit.ecrire(db, { action: 'verify_echec', telephone: telephoneDigits, ip });
    return { status: 404, payload: { error: 'Utilisateur introuvable. Réinscrivez-vous.' } };
  }

  runSql(db, 'UPDATE auth_otps SET used = 1 WHERE id = ?', [otp.id]);
  runSql(db, 'UPDATE users SET telephone_verified = 1 WHERE id = ?', [user.id]);
  await otpService.invalidateOtps(db, telephoneDigits);
  authAudit.ecrire(db, { userId: user.id, action: 'verify_succes', telephone: telephoneDigits, ip });

  return {
    status: 200,
    user: { ...user, telephone_verified: 1, role: 'joueur' },
    tokenPayload: {
      id: user.id,
      email: user.email,
      telephone: user.telephone,
      role: 'joueur',
      accountType: 'user',
    },
  };
}

module.exports = { registerJoueur, verifyOtpJoueur };
