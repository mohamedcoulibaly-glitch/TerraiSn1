/**
 * Fenêtre de check-in — règle métier workflow QR / file d'attente gérant.
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

/** heure_debut - now <= 30 min ET > 0 */
export function estImminente(creneau: CreneauFenetre, maintenant: number = Date.now()): boolean {
  const { heureDebutMs } = calculerFenetreCheckIn(creneau);
  const delta = heureDebutMs - maintenant;
  return delta <= 30 * 60 * 1000 && delta > 0;
}

/** now >= heure_debut - 1h ET now <= heure_fin + retard + 2h */
export function estDansFenetre(creneau: CreneauFenetre, maintenant: number = Date.now()): boolean {
  return estDansLaFenetreCheckIn(creneau, maintenant);
}

/** now >= heure_debut ET now <= heure_fin + fenetre_retard */
export function estEnCours(creneau: CreneauFenetre, maintenant: number = Date.now()): boolean {
  const { heureDebutMs, heureFinMs, retardMin } = calculerFenetreCheckIn(creneau);
  return maintenant >= heureDebutMs && maintenant <= heureFinMs + retardMin * 60 * 1000;
}

/** now > heure_fin + fenetre_retard ET statut === match_joue */
export function estTerminee(
  creneau: CreneauFenetre,
  statut: string,
  maintenant: number = Date.now(),
): boolean {
  const { heureFinMs, retardMin } = calculerFenetreCheckIn(creneau);
  const pastEnd = maintenant > heureFinMs + retardMin * 60 * 1000;
  return pastEnd && ["match_joue", "joue"].includes(String(statut || ""));
}

export type LiveMatchFlags = {
  estImminente: boolean;
  estDansFenetre: boolean;
  estEnCours: boolean;
  estTerminee: boolean;
};

export function calculerFlagsMatch(
  creneau: CreneauFenetre,
  statut: string,
  maintenant: number = Date.now(),
): LiveMatchFlags {
  return {
    estImminente: estImminente(creneau, maintenant),
    estDansFenetre: estDansFenetre(creneau, maintenant),
    estEnCours: estEnCours(creneau, maintenant),
    estTerminee: estTerminee(creneau, statut, maintenant),
  };
}
