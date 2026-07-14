const crypto = require('crypto');
const { queryOne, runSql } = require('./database');
const { envoyerMessage } = require('./notificationService');

/** Normalise un numéro sénégalais en digits (221XXXXXXXXX ou 9 chiffres locaux). */
function normalizeTelephone(telephone) {
  let digits = String(telephone || '').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 9 && digits.startsWith('7')) digits = `221${digits}`;
  return digits;
}

function isValidSenegalMobile(telephone) {
  const digits = normalizeTelephone(telephone);
  // 221 + 7X XXX XX XX
  return /^2217\d{8}$/.test(digits);
}

function formatDisplayPhone(telephone) {
  const digits = normalizeTelephone(telephone);
  if (digits.startsWith('221') && digits.length === 12) {
    return `+${digits.slice(0, 3)} ${digits.slice(3, 5)} ${digits.slice(5, 8)} ${digits.slice(8, 10)} ${digits.slice(10)}`;
  }
  return telephone;
}

function generateOtpCode() {
  return String(crypto.randomInt(100000, 999999));
}

async function invalidateOtps(db, telephoneDigits) {
  runSql(db, 'UPDATE auth_otps SET used = 1 WHERE telephone = ? AND used = 0', [telephoneDigits]);
}

async function createAndSendOtp(db, { telephone, userId }) {
  const telephoneDigits = normalizeTelephone(telephone);
  if (!isValidSenegalMobile(telephoneDigits)) {
    throw new Error('Numéro de téléphone sénégalais invalide (format 7X XXX XX XX)');
  }

  await invalidateOtps(db, telephoneDigits);

  const code = generateOtpCode();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  runSql(
    db,
    'INSERT INTO auth_otps (telephone, code, user_id, expires_at, used) VALUES (?, ?, ?, ?, 0)',
    [telephoneDigits, code, userId || null, expiresAt]
  );

  const message = `🔐 Votre code de vérification : ${code}. Valable 10 minutes.`;
  try {
    await envoyerMessage(formatDisplayPhone(telephoneDigits), message);
  } catch (err) {
    // OTP déjà stocké : on logue le code pour debug / mock partiel
    console.warn(`[OTP] Envoi WhatsApp échoué (${telephoneDigits}): ${err.message}`);
    console.log(`[OTP] Code de vérification : ${code} (valable jusqu'à ${expiresAt})`);
    if (String(process.env.WHATSAPP_MOCK).toLowerCase() !== 'true') {
      // On ne bloque pas : le code est en DB, verify-otp / resend-otp restent possibles
    }
  }

  return { telephone: telephoneDigits, expiresAt, code };
}

function findValidOtp(db, telephone, code) {
  const telephoneDigits = normalizeTelephone(telephone);
  const otp = queryOne(
    db,
    `SELECT * FROM auth_otps
     WHERE telephone = ? AND code = ? AND used = 0
     ORDER BY id DESC LIMIT 1`,
    [telephoneDigits, String(code || '').trim()]
  );
  if (!otp) return { error: 'Code invalide' };
  if (new Date(otp.expires_at).getTime() < Date.now()) {
    return { error: 'Code expiré. Demandez un nouveau code.' };
  }
  return { otp, telephoneDigits };
}

module.exports = {
  normalizeTelephone,
  isValidSenegalMobile,
  formatDisplayPhone,
  generateOtpCode,
  createAndSendOtp,
  findValidOtp,
  invalidateOtps,
};
