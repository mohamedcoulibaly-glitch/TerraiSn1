/** Helpers feature flags terrain (réponse API `features: Record<string, boolean>`). */

export type TerrainFeaturesMap = Record<string, boolean>;

const DEFAULTS: TerrainFeaturesMap = {
  reservations_en_ligne: true,
  confirmations_manuelles: true,
  abonnements: false,
  tournois: true,
  geolocalisation: true,
  score_sante: true,
  dette_commission: true,
};

export function featureEnabled(
  features: TerrainFeaturesMap | null | undefined,
  cle: string,
  fallback?: boolean,
): boolean {
  if (features && Object.prototype.hasOwnProperty.call(features, cle)) {
    return Boolean(features[cle]);
  }
  if (fallback != null) return fallback;
  return Boolean(DEFAULTS[cle] ?? true);
}
