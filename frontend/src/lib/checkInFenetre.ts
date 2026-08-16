/**
 * Fenêtre de check-in — règle métier workflow QR.
 * debut = heure_debut - 1h
 * fin   = heure_fin + fenetre_retard + 2h
 */

export const DEFAULT_FENETRE_RETARD_MIN = 30;

export type CreneauFenetre = {
  date: string;
  heure_debut: string;
  heure_fin: string;
  fenetre_retard?: number | null;
};

function parseTimeParts(heure: string) {
  const [h, m] = String(heure || "00:00")
    .slice(0, 5)
    .split(":")
    .map(Number);
  return { h: h || 0, m: m || 0 };
}

function atDateTime(date: string, heure: string) {
  const { h, m } = parseTimeParts(heure);
  const d = new Date(`${String(date).slice(0, 10)}T00:00:00`);
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

export function normaliserFenetreRetard(value?: number | null) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_FENETRE_RETARD_MIN;
  return n;
}

export function calculerFenetreCheckIn(creneau: CreneauFenetre) {
  const retardMin = normaliserFenetreRetard(creneau.fenetre_retard);
  const heureDebutMs = atDateTime(creneau.date, creneau.heure_debut);
  const heureFinMs = atDateTime(creneau.date, creneau.heure_fin);
  const debutFenetre = heureDebutMs - 60 * 60 * 1000;
  const finFenetre = heureFinMs + retardMin * 60 * 1000 + 2 * 60 * 60 * 1000;
  return { debutFenetre, finFenetre, retardMin, heureDebutMs, heureFinMs };
}

export function estDansLaFenetreCheckIn(
  creneau: CreneauFenetre,
  maintenant: number = Date.now(),
): boolean {
  const { debutFenetre, finFenetre } = calculerFenetreCheckIn(creneau);
  return maintenant >= debutFenetre && maintenant <= finFenetre;
}
