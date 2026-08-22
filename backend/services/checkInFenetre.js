/**
 * Fenêtre de check-in (règle métier workflow QR).
 * debut = heure_debut - 1h
 * fin   = heure_fin + fenetre_retard + 2h
 */

const DEFAULT_FENETRE_RETARD_MIN = 30;

/** Normalise une date PG (Date | ISO | YYYY-MM-DD) → YYYY-MM-DD */
function toYmd(date) {
  if (date == null) return '';
  if (date instanceof Date && !Number.isNaN(date.getTime())) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(date).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const d = String(parsed.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return s.slice(0, 10);
}

function toMinutesParts(heure) {
  const [h, m] = String(heure || '00:00').slice(0, 5).split(':').map(Number);
  return { h: h || 0, m: m || 0 };
}

function creneauStartMs(date, heureDebut) {
  const { h, m } = toMinutesParts(heureDebut);
  const d = new Date(`${toYmd(date)}T00:00:00`);
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

function creneauEndMs(date, heureFin) {
  const { h, m } = toMinutesParts(heureFin);
  const d = new Date(`${toYmd(date)}T00:00:00`);
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

function normaliserFenetreRetard(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_FENETRE_RETARD_MIN;
  return n;
}

function calculerFenetreCheckIn({ date, heure_debut, heure_fin, fenetre_retard }) {
  const retardMin = normaliserFenetreRetard(fenetre_retard);
  const heureDebutMs = creneauStartMs(date, heure_debut);
  const heureFinMs = creneauEndMs(date, heure_fin);
  const debutFenetre = heureDebutMs - 60 * 60 * 1000;
  const finFenetre = heureFinMs + retardMin * 60 * 1000 + 2 * 60 * 60 * 1000;
  return { debutFenetre, finFenetre, retardMin, heureDebutMs, heureFinMs };
}

function estDansLaFenetreCheckIn(creneau, maintenant = Date.now()) {
  const { debutFenetre, finFenetre } = calculerFenetreCheckIn(creneau);
  return maintenant >= debutFenetre && maintenant <= finFenetre;
}

/** Clé de tri : le créneau le plus tôt (date + heure) est prioritaire. */
function prioriteScanKey(row) {
  const date = toYmd(row.date || row.creneau_date);
  const heure = String(row.heure_debut || row.creneau_heure_debut || '99:99').slice(0, 5);
  const id = String(row.id || row.reservation_id || 0).padStart(10, '0');
  return `${date}|${heure}|${id}`;
}

function trierParPrioriteScan(rows = []) {
  return [...rows].sort((a, b) => prioriteScanKey(a).localeCompare(prioriteScanKey(b)));
}

/**
 * Parmi les résas déjà dans la fenêtre de validation, seule la plus haute
 * (heure de début la plus proche / la plus tôt) est scannable.
 */
function assertPrioriteScanUnique(reservation, candidatsDansFenetre = []) {
  const sorted = trierParPrioriteScan(candidatsDansFenetre);
  if (!sorted.length) return;
  const premier = sorted[0];
  const targetId = Number(reservation.id || reservation.reservation_id);
  const premierId = Number(premier.id || premier.reservation_id);
  if (premierId && targetId && premierId !== targetId) {
    const heure = String(premier.heure_debut || premier.creneau_heure_debut || '').slice(0, 5);
    const qui = premier.joueur_nom || premier.code_reservation || 'le créneau prioritaire';
    const error = new Error(
      `Un seul créneau scannable à la fois. Valide d'abord ${heure || 'le créneau précédent'} (${qui}), puis celui-ci.`,
    );
    error.statusCode = 409;
    error.code = 'QR_SCAN_PRIORITY';
    error.priorite_reservation_id = premierId;
    error.priorite_heure = heure || null;
    error.priorite_joueur = premier.joueur_nom || null;
    throw error;
  }
}

function idPrioriteScannable(candidatsDansFenetre = []) {
  const sorted = trierParPrioriteScan(candidatsDansFenetre);
  if (!sorted.length) return null;
  return Number(sorted[0].id || sorted[0].reservation_id) || null;
}

function assertFenetreScanQr(creneau, maintenant = Date.now()) {
  const { debutFenetre, finFenetre, retardMin } = calculerFenetreCheckIn(creneau);

  if (maintenant < debutFenetre) {
    const error = new Error(
      `Ce QR code n'est scannable qu'à partir d'1h avant le match et jusqu'à ${2 + retardMin / 60}h après sa fin (dont ${retardMin} min de tolérance).`
    );
    error.statusCode = 400;
    error.code = 'QR_SCAN_TOO_EARLY';
    error.scannable_at = new Date(debutFenetre).toISOString();
    error.minutes_remaining = Math.ceil((debutFenetre - maintenant) / (60 * 1000));
    error.match_date = creneau.date;
    error.match_time = creneau.heure_debut;
    throw error;
  }
  if (maintenant > finFenetre) {
    const error = new Error('La fenêtre de validation pour ce match est dépassée.');
    error.statusCode = 400;
    error.code = 'QR_SCAN_EXPIRED';
    error.match_date = creneau.date;
    error.match_time = creneau.heure_debut;
    throw error;
  }
}

module.exports = {
  DEFAULT_FENETRE_RETARD_MIN,
  toYmd,
  calculerFenetreCheckIn,
  estDansLaFenetreCheckIn,
  assertFenetreScanQr,
  assertPrioriteScanUnique,
  trierParPrioriteScan,
  prioriteScanKey,
  idPrioriteScannable,
  normaliserFenetreRetard,
};
