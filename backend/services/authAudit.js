const { runSql } = require('../database');

const SECRET_KEYS = /password|otp|code|secret|token/i;

function masquerTelephone(telephone) {
  const digits = String(telephone || '').replace(/\D/g, '');
  const local = digits.length >= 9 ? digits.slice(-9) : digits;
  if (local.length < 4) return '****';
  return `${local.slice(0, 2)}*****${local.slice(-2)}`;
}

function metaSure(meta) {
  if (!meta || typeof meta !== 'object') return null;
  const out = {};
  for (const [key, value] of Object.entries(meta)) {
    if (SECRET_KEYS.test(key)) continue;
    out[key] = value;
  }
  return JSON.stringify(out);
}

function ecrire(db, { userId = null, action, telephone = null, meta = null, ip = null } = {}) {
  if (!action) return null;
  return runSql(
    db,
    `INSERT INTO auth_audit (user_id, action, telephone_masque, meta, ip)
     VALUES (?, ?, ?, ?, ?)`,
    [
      userId ? Number(userId) : null,
      String(action),
      telephone ? masquerTelephone(telephone) : null,
      metaSure(meta),
      ip ? String(ip).slice(0, 64) : null,
    ],
  );
}

module.exports = { ecrire, masquerTelephone, metaSure };
