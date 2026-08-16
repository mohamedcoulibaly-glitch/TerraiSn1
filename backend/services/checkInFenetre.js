/**
 * Fenêtre de check-in (règle métier workflow QR).
 * debut = heure_debut - 1h
 * fin   = heure_fin + fenetre_retard + 2h
 */

const DEFAULT_FENETRE_RETARD_MIN = 30;

function toMinutesParts(heure) {
  const [h, m] = String(heure || '00:00').slice(0, 5).split(':').map(Number);
  return { h: h || 0, m: m || 0 };
}

function creneauStartMs(date, heureDebut) {
  const { h, m } = toMinutesParts(heureDebut);
  const d = new Date(`${String(date).slice(0, 10)}T00:00:00`);
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

function creneauEndMs(date, heureFin) {
  const { h, m } = toMinutesParts(heureFin);
  const d = new Date(`${String(date).slice(0, 10)}T00:00:00`);
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
  calculerFenetreCheckIn,
  estDansLaFenetreCheckIn,
  assertFenetreScanQr,
  normaliserFenetreRetard,
};
