/**
 * Upsert compte JOUEUR Babacar Sene — seed persistant.
 * Numéro : 75 014 71 38 (+221) — mot de passe : password123
 *
 * Idempotent : retrouvé par téléphone (chiffres), jamais dupliqué.
 * Appelé à chaque démarrage serveur (même SKIP_SEED=true) pour que le
 * compte survive à une DB Render free éphémère.
 *
 * Usage : node scripts/ensure-babacar-joueur.js
 *         require('./scripts/ensure-babacar-joueur').ensureBabacarJoueur()
 */
const bcrypt = require('bcryptjs');
const { getDb, queryOne, queryAll, runSql, saveDb } = require('../database');
const otpService = require('../otpService');

const BABACAR_JOUEUR_PASSWORD = 'password123';
const BABACAR_JOUEUR_EMAIL = 'babacar.joueur@gmail.com';
const BABACAR_JOUEUR_PHONE_DIGITS = '221750147138';
const BABACAR_JOUEUR_PHONE_STORE = '+221 75 014 71 38';
const BABACAR_JOUEUR_NOM = 'Sene';
const BABACAR_JOUEUR_PRENOM = 'Babacar';

function trouverTousParTelephone(db, phoneDigits) {
  return queryAll(db, 'SELECT id, email, telephone FROM users')
    .filter((u) => otpService.normalizeTelephone(u.telephone) === phoneDigits)
    .sort((a, b) => Number(a.id) - Number(b.id));
}

/** Fusionne les doublons même numéro vers le compte principal (plus ancien id). */
function fusionnerDoublons(db, primaryId, doublons) {
  for (const dup of doublons) {
    const dupId = Number(dup.id);
    if (dupId === Number(primaryId)) continue;
    // Réaffecter l'historique connu avant suppression du doublon
    for (const table of ['reservations', 'avis', 'auth_otps', 'auth_audit']) {
      try {
        const col = table === 'reservations' || table === 'avis' ? 'joueur_id' : 'user_id';
        runSql(db, `UPDATE ${table} SET ${col} = ? WHERE ${col} = ?`, [primaryId, dupId]);
      } catch {
        // table/colonne absente selon schéma — ignorer
      }
    }
    runSql(db, 'DELETE FROM users WHERE id = ?', [dupId]);
  }
}

async function ensureBabacarJoueur(opts = {}) {
  const db = opts.db || (await getDb());
  const silent = Boolean(opts.silent);
  const hash = bcrypt.hashSync(BABACAR_JOUEUR_PASSWORD, 10);

  const parTel = trouverTousParTelephone(db, BABACAR_JOUEUR_PHONE_DIGITS);
  const parEmail = queryOne(db, 'SELECT id FROM users WHERE email = ?', [BABACAR_JOUEUR_EMAIL]);
  const existing = parTel[0] || parEmail;

  let joueurId;
  if (existing) {
    // Ne voler l'email que s'il n'appartient pas à un autre compte
    const emailLibre = !parEmail || Number(parEmail.id) === Number(existing.id);
    runSql(
      db,
      `UPDATE users SET nom = ?, prenom = ?,
         ${emailLibre ? 'email = ?,' : ''}
         password_hash = ?, telephone = ?, role = 'joueur',
         is_active = 1, telephone_verified = 1, must_change_password = 0, is_banned = 0
       WHERE id = ?`,
      emailLibre
        ? [BABACAR_JOUEUR_NOM, BABACAR_JOUEUR_PRENOM, BABACAR_JOUEUR_EMAIL, hash, BABACAR_JOUEUR_PHONE_STORE, existing.id]
        : [BABACAR_JOUEUR_NOM, BABACAR_JOUEUR_PRENOM, hash, BABACAR_JOUEUR_PHONE_STORE, existing.id],
    );
    joueurId = Number(existing.id);
  } else {
    joueurId = Number(
      runSql(
        db,
        `INSERT INTO users (nom, prenom, email, password_hash, telephone, role, is_active, telephone_verified, must_change_password)
         VALUES (?, ?, ?, ?, ?, 'joueur', 1, 1, 0)`,
        [BABACAR_JOUEUR_NOM, BABACAR_JOUEUR_PRENOM, BABACAR_JOUEUR_EMAIL, hash, BABACAR_JOUEUR_PHONE_STORE],
      ).lastInsertRowid,
    );
  }

  // Un seul compte pour ce numéro (sinon le login téléphone devient ambigu)
  const doublons = trouverTousParTelephone(db, BABACAR_JOUEUR_PHONE_DIGITS).filter(
    (u) => Number(u.id) !== Number(joueurId),
  );
  if (doublons.length) fusionnerDoublons(db, joueurId, doublons);

  saveDb();

  const joueur = queryOne(
    db,
    'SELECT id, nom, prenom, email, telephone, role, is_active, telephone_verified, password_hash FROM users WHERE id = ?',
    [joueurId],
  );
  const okLogin = Boolean(
    joueur?.id &&
      Number(joueur.is_active) === 1 &&
      Number(joueur.telephone_verified) === 1 &&
      bcrypt.compareSync(BABACAR_JOUEUR_PASSWORD, joueur.password_hash),
  );
  if (!okLogin) {
    throw new Error('ensure-babacar-joueur : validation login échouée');
  }

  if (!silent) {
    console.log('=== Compte joueur Babacar Sene ===');
    console.log(`id=${joueur.id}  ${joueur.prenom} ${joueur.nom}`);
    console.log(`Téléphone : ${joueur.telephone} (login : 750147138)`);
    console.log(`Email     : ${joueur.email}`);
    console.log(`Mot de passe : ${BABACAR_JOUEUR_PASSWORD}`);
    console.log(`Vérifié=${joueur.telephone_verified} actif=${joueur.is_active} login=${okLogin}`);
  }

  return { joueurId, email: BABACAR_JOUEUR_EMAIL, telephone: BABACAR_JOUEUR_PHONE_STORE };
}

module.exports = {
  ensureBabacarJoueur,
  BABACAR_JOUEUR_PASSWORD,
  BABACAR_JOUEUR_EMAIL,
  BABACAR_JOUEUR_PHONE_DIGITS,
  BABACAR_JOUEUR_PHONE_STORE,
};

if (require.main === module) {
  ensureBabacarJoueur().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
