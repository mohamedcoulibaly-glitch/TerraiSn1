/** Avance = pourcentage du prix choisi. Défaut métier : 8 %. */
export const POURCENTAGE_AVANCE_DEFAUT = 8;

export function calculerMontantAvance(
  prixChoisi: number,
  pourcentageAvance?: number | null
): number {
  const montant = Number(prixChoisi || 0);
  if (!Number.isFinite(montant) || montant <= 0) return 0;
  const pct = Number(pourcentageAvance);
  const taux = Number.isFinite(pct) && pct > 0 ? pct : POURCENTAGE_AVANCE_DEFAUT;
  return Math.min(montant, Math.round((montant * taux) / 100));
}
