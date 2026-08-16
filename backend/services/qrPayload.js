/**
 * Contenu QR métier (workflow) — JSON unique lié à la réservation.
 */

function buildQrPayload({ reservation_id, code, creneau_id, terrain_id, expire_at }) {
  return {
    reservation_id: Number(reservation_id),
    code: String(code || '').toUpperCase(),
    creneau_id: creneau_id == null ? null : Number(creneau_id),
    terrain_id: Number(terrain_id),
    expire_at: Number(expire_at),
  };
}

function serializeQrPayload(payload) {
  return JSON.stringify(buildQrPayload(payload));
}

function parseQrPayload(rawValue) {
  const raw = String(rawValue || '').trim();
  if (!raw) return { ok: false, error: 'QR vide' };

  // Format JSON workflow
  if (raw.startsWith('{')) {
    try {
      const data = JSON.parse(raw);
      const reservation_id = Number(data.reservation_id);
      const code = String(data.code || '').toUpperCase();
      if (!Number.isFinite(reservation_id) || reservation_id < 1) {
        return { ok: false, error: 'reservation_id manquant' };
      }
      if (!code) return { ok: false, error: 'code manquant' };
      return {
        ok: true,
        format: 'json',
        reservation_id,
        code,
        creneau_id: data.creneau_id == null ? null : Number(data.creneau_id),
        terrain_id: data.terrain_id == null ? null : Number(data.terrain_id),
        expire_at: data.expire_at == null ? null : Number(data.expire_at),
        raw,
      };
    } catch {
      return { ok: false, error: 'JSON QR invalide' };
    }
  }

  // Compat legacy : code TF-… ou id numérique
  const codeMatch = raw.match(/\b(TF-[A-Z0-9-]+)\b/i);
  if (codeMatch) {
    return {
      ok: true,
      format: 'code',
      reservation_id: null,
      code: codeMatch[1].toUpperCase(),
      raw,
    };
  }
  const numberMatch = raw.match(/^\d{1,12}$/);
  if (numberMatch) {
    return {
      ok: true,
      format: 'id',
      reservation_id: Number(numberMatch[0]),
      code: null,
      raw,
    };
  }
  return { ok: false, error: 'Format QR non reconnu' };
}

/**
 * Vérifie que le QR correspond exactement à la réservation ouverte.
 */
function assertQrMatchesReservation(parsed, reservation) {
  if (!parsed?.ok) {
    const error = new Error('QR code non reconnu. Demande au joueur de montrer celui reçu par WhatsApp.');
    error.statusCode = 400;
    error.code = 'QR_INVALID';
    throw error;
  }

  const expectedId = Number(reservation.id);
  const expectedCode = String(reservation.code_reservation || '').toUpperCase();

  if (parsed.reservation_id != null && Number(parsed.reservation_id) !== expectedId) {
    const error = new Error('QR code invalide ou non reconnu.');
    error.statusCode = 400;
    error.code = 'QR_MISMATCH';
    throw error;
  }
  if (parsed.code && expectedCode && parsed.code !== expectedCode) {
    const error = new Error('QR code invalide ou non reconnu.');
    error.statusCode = 400;
    error.code = 'QR_MISMATCH';
    throw error;
  }
  // Si seul l'id est fourni (legacy), OK s'il matche l'URL/fiche
  if (parsed.format === 'id' && Number(parsed.reservation_id) !== expectedId) {
    const error = new Error('QR code invalide ou non reconnu.');
    error.statusCode = 400;
    error.code = 'QR_MISMATCH';
    throw error;
  }
  // Si format code seul sans id : le code doit matcher
  if (parsed.format === 'code' && parsed.code !== expectedCode) {
    const error = new Error('QR code invalide ou non reconnu.');
    error.statusCode = 400;
    error.code = 'QR_MISMATCH';
    throw error;
  }
  if (parsed.terrain_id != null && Number(parsed.terrain_id) !== Number(reservation.terrain_id)) {
    const error = new Error('Ce QR code ne correspond pas à ton terrain.');
    error.statusCode = 403;
    error.code = 'QR_WRONG_TERRAIN';
    throw error;
  }
  if (
    parsed.creneau_id != null &&
    reservation.creneau_id != null &&
    Number(parsed.creneau_id) !== Number(reservation.creneau_id)
  ) {
    const error = new Error('QR code invalide ou non reconnu.');
    error.statusCode = 400;
    error.code = 'QR_MISMATCH';
    throw error;
  }
}

module.exports = {
  buildQrPayload,
  serializeQrPayload,
  parseQrPayload,
  assertQrMatchesReservation,
};
