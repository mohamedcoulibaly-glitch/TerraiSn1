/**
 * Fenêtre de check-in — règle métier workflow QR / file d'attente gérant.
 * debut = heure_debut - 1h
 * fin   = heure_fin + fenetre_retard + 2h
 */

export const DEFAULT_FENETRE_RETARD_MIN = 30;
/** Un match est « imminent » dans l’heure qui précède le coup d’envoi. */
export const FENETRE_IMMINENTE_MS = 60 * 60 * 1000;

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

export type PrioriteScanRow = CreneauFenetre & {
  id: number;
  joueur_nom?: string | null;
  code_reservation?: string | null;
  qr_code_scanne_at?: string | null;
  statut?: string | null;
};

function prioriteScanKey(row: PrioriteScanRow) {
  const date = String(row.date || "").slice(0, 10);
  const heure = String(row.heure_debut || "99:99").slice(0, 5);
  const id = String(row.id || 0).padStart(10, "0");
  return `${date}|${heure}|${id}`;
}

/** Parmi les réservations confirmées non scannées déjà dans la fenêtre : l’id du seul créneau scannable. */
export function idPrioriteScannable(
  rows: PrioriteScanRow[],
  maintenant: number = Date.now(),
): number | null {
  const candidats = rows
    .filter((r) => ["confirme", "acceptee"].includes(String(r.statut || "confirme")))
    .filter((r) => !r.qr_code_scanne_at)
    .filter((r) => estDansLaFenetreCheckIn(r, maintenant))
    .sort((a, b) => prioriteScanKey(a).localeCompare(prioriteScanKey(b)));
  return candidats.length ? Number(candidats[0].id) : null;
}

export function estScannableMaintenant(
  row: PrioriteScanRow,
  siblings: PrioriteScanRow[],
  maintenant: number = Date.now(),
): boolean {
  if (row.qr_code_scanne_at) return false;
  if (!["confirme", "acceptee"].includes(String(row.statut || ""))) return false;
  if (!estDansLaFenetreCheckIn(row, maintenant)) return false;
  const top = idPrioriteScannable(siblings.length ? siblings : [row], maintenant);
  return Boolean(top && Number(top) === Number(row.id));
}

/** heure_debut - now <= 1 h ET > 0 */
export function estImminente(creneau: CreneauFenetre, maintenant: number = Date.now()): boolean {
  const { heureDebutMs } = calculerFenetreCheckIn(creneau);
  const delta = heureDebutMs - maintenant;
  return delta <= FENETRE_IMMINENTE_MS && delta > 0;
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

/**
 * Heure de début atteinte, match encore dans la fenêtre « en cours »,
 * mais réservation non scannée → statut d'affichage « en retard ».
 */
export function estEnRetardHoraire(
  creneau: CreneauFenetre,
  maintenant: number = Date.now(),
): boolean {
  return estEnCours(creneau, maintenant);
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
  estEnRetardHoraire: boolean;
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
    estEnRetardHoraire: estEnRetardHoraire(creneau, maintenant),
    estTerminee: estTerminee(creneau, statut, maintenant),
  };
}
