/**
 * Codes numériques de réservation (TF-XXXXXX) — source de vérité unique.
 *
 * Le joueur reçoit ce code par WhatsApp (avec le QR). À l'entrée, le gérant
 * peut le saisir manuellement : la validation doit alors prouver que le code
 * saisi CORRESPOND à la réservation (intégrité), sans dépendre du terrain
 * « actif » affiché dans l'app (cohérence multi-terrains).
 *
 * Avant : normalisations différentes front/back, code saisi jamais comparé
 * en mode fiche, résolution limitée au terrain du JWT → codes identiques
 * refusés ou, pire, entrées validées sans vérification du code.
 */
const { queryAll, queryOne } = require('../database');

/** Format actuel des codes générés. */
const CODE_REGEX = /^TF-\d{6}$/;
/** Anciens codes encore présents en base (ex. TF-MOH-2H). */
const CODE_LEGACY_REGEX = /^TF-[A-Z0-9][A-Z0-9-]{2,}$/;

/**
 * Normalise une saisie humaine vers la forme stockée :
 * 'tf 774 886', 'TF774886', '774886', 'Tf-774886' → 'TF-774886'.
 * Renvoie '' si la saisie est vide, sinon la forme normalisée (même si le
 * format final est invalide — c'est codeReservationValide qui tranche).
 */
function normaliserCodeReservation(saisie) {
  const brut = String(saisie || '').trim().toUpperCase().replace(/[\s.]/g, '');
  if (!brut) return '';
  if (/^\d{6}$/.test(brut)) return `TF-${brut}`;
  if (/^TF\d{6}$/.test(brut)) return `TF-${brut.slice(2)}`;
  if (/^TF-[A-Z0-9-]+$/.test(brut)) return brut.replace(/-{2,}/g, '-');
  return brut;
}

function codeReservationValide(codeNormalise) {
  return CODE_REGEX.test(codeNormalise) || CODE_LEGACY_REGEX.test(codeNormalise);
}

/** Correspondance stricte après normalisation des deux côtés. */
function codesCorrespondent(saisi, attendu) {
  const a = normaliserCodeReservation(saisi);
  const b = normaliserCodeReservation(attendu);
  return Boolean(a) && a === b;
}

/**
 * Génère un code TF-XXXXXX garanti unique en base (anti-collision).
 * `random` injectable pour les tests de collision.
 */
function genererCodeReservation(db, { random = Math.random, maxEssais = 20 } = {}) {
  for (let attempt = 0; attempt < maxEssais; attempt += 1) {
    const code = `TF-${Math.floor(100000 + random() * 900000)}`;
    if (!queryOne(db, 'SELECT id FROM reservations WHERE code_reservation = ?', [code])) return code;
  }
  throw new Error('Impossible de générer un code de réservation unique');
}

function erreurCode(message, code, statusCode) {
  const err = new Error(message);
  err.code = code;
  err.statusCode = statusCode;
  return err;
}

/**
 * Résout un code saisi vers SA réservation (recherche globale, pas limitée
 * à un terrain : c'est l'autorisation, séparée, qui décide ensuite).
 * Lève CODE_FORMAT_INVALIDE (400), QR_CODE_NOT_FOUND (404),
 * CODE_RESERVATION_DUPLIQUE (500, intégrité base violée).
 */
function resoudreReservationParCode(db, saisie) {
  const code = normaliserCodeReservation(saisie);
  if (!codeReservationValide(code)) {
    throw erreurCode('Code invalide. Format attendu : TF-XXXXXX (ex. TF-774886).', 'CODE_FORMAT_INVALIDE', 400);
  }
  const rows = queryAll(
    db,
    `SELECT r.*, t.nom AS terrain_nom
     FROM reservations r
     JOIN terrains t ON t.id = r.terrain_id
     WHERE UPPER(r.code_reservation) = ?
     LIMIT 2`,
    [code],
  );
  if (!rows.length) {
    throw erreurCode('Code non reconnu. Vérifie le code du joueur (ex. TF-XXXXXX).', 'QR_CODE_NOT_FOUND', 404);
  }
  if (rows.length > 1) {
    throw erreurCode('Intégrité : plusieurs réservations partagent ce code.', 'CODE_RESERVATION_DUPLIQUE', 500);
  }
  const reservation = rows[0];
  // Garde-fou final : ce qui est renvoyé correspond EXACTEMENT au code saisi.
  if (!codesCorrespondent(code, reservation.code_reservation)) {
    throw erreurCode('Code non reconnu. Vérifie le code du joueur (ex. TF-XXXXXX).', 'QR_CODE_NOT_FOUND', 404);
  }
  return { code, reservation };
}

/**
 * Le gérant peut-il valider cette réservation ? On regarde TOUS ses terrains
 * (gerants_terrains via req.user.terrains_ids enrichi par l'auth), pas
 * seulement le terrain « actif » du moment — cause historique de refus
 * systématiques quand le mauvais terrain était sélectionné dans l'app.
 */
function gerantPeutValiderReservation(user, reservation) {
  if (!user || !reservation) return false;
  const terrainId = Number(reservation.terrain_id);
  if (Array.isArray(user.terrains_ids) && user.terrains_ids.length) {
    return user.terrains_ids.map(Number).includes(terrainId);
  }
  return Number(user.terrain_id) === terrainId;
}

function assertGerantPeutValider(user, reservation) {
  if (!gerantPeutValiderReservation(user, reservation)) {
    throw erreurCode('Ce code ne correspond pas à ton terrain', 'QR_WRONG_TERRAIN', 403);
  }
}

module.exports = {
  CODE_REGEX,
  CODE_LEGACY_REGEX,
  normaliserCodeReservation,
  codeReservationValide,
  codesCorrespondent,
  genererCodeReservation,
  resoudreReservationParCode,
  gerantPeutValiderReservation,
  assertGerantPeutValider,
};
