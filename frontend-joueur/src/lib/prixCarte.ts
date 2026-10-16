/** Prix affiché sur la carte d'accueil. Défaut : demi-terrain (US-22). */
export function prixAfficheCarte(terrain: {
  prix_affiche?: number | string | null;
  prix_carte_source?: string | null;
  prix_moitie?: number | string | null;
  prix_entier?: number | string | null;
  prix_heure?: number | string | null;
  prix_terrain_entier?: number | string | null;
} | null | undefined): number {
  if (!terrain) return 0;
  const direct = Number(terrain.prix_affiche);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const demi = Number(terrain.prix_moitie);
  const entier = Number(terrain.prix_entier ?? terrain.prix_heure ?? terrain.prix_terrain_entier);
  const source = String(terrain.prix_carte_source || "demi");
  if (source === "entier" && Number.isFinite(entier) && entier > 0) return entier;
  if (Number.isFinite(demi) && demi > 0) return demi;
  if (Number.isFinite(entier) && entier > 0) return entier;
  return 0;
}
