const crypto = require('crypto');

function resolveQrSecret() {
  const secret = String(process.env.QR_HMAC_SECRET || '').trim();
  if (secret) return secret;
  if (process.env.NODE_ENV === 'production') return null;
  return 'dev-qr-hmac-secret';
}

function canonicalBody(payload) {
  return {
    reservation_id: Number(payload.reservation_id),
    code: String(payload.code || '').toUpperCase(),
    creneau_id: payload.creneau_id == null ? null : Number(payload.creneau_id),
    terrain_id: Number(payload.terrain_id),
    expire_at: Number(payload.expire_at),
  };
}

function canonicalString(payload) {
  return JSON.stringify(canonicalBody(payload));
}

function hmac(payload, secret) {
  return crypto.createHmac('sha256', secret).update(canonicalString(payload)).digest('hex');
}

function signQrPayload(payload, secret = resolveQrSecret()) {
  if (!secret) {
    const error = new Error('QR_HMAC_SECRET manquant');
    error.statusCode = 500;
    error.code = 'QR_SECRET_MISSING';
    throw error;
  }
  const body = canonicalBody(payload);
  return JSON.stringify({ ...body, sig: hmac(body, secret) });
}

function verifyQrPayload(rawValue, secret = resolveQrSecret()) {
  const raw = String(rawValue || '').trim();
  if (!raw.startsWith('{')) {
    return { ok: false, code: 'QR_INVALID', error: 'QR non signé' };
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, code: 'QR_INVALID', error: 'JSON QR invalide' };
  }
  if (!secret) {
    return { ok: false, code: 'QR_INVALID', error: 'Secret QR absent' };
  }
  const expected = hmac(data, secret);
  const given = String(data.sig || '');
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, code: 'QR_INVALID', error: 'Signature QR invalide' };
  }
  return {
    ok: true,
    format: 'json',
    reservation_id: Number(data.reservation_id),
    code: String(data.code || '').toUpperCase(),
    creneau_id: data.creneau_id == null ? null : Number(data.creneau_id),
    terrain_id: Number(data.terrain_id),
    expire_at: Number(data.expire_at),
    sig: given,
    raw,
  };
}

function assertScanSignature(rawValue, secret = resolveQrSecret()) {
  const verified = verifyQrPayload(rawValue, secret);
  if (!verified.ok) {
    const error = new Error('QR code non reconnu. Demande au joueur de montrer celui reçu par WhatsApp.');
    error.statusCode = 400;
    error.code = verified.code || 'QR_INVALID';
    throw error;
  }
  return verified;
}

module.exports = {
  resolveQrSecret,
  canonicalBody,
  signQrPayload,
  verifyQrPayload,
  assertScanSignature,
};
