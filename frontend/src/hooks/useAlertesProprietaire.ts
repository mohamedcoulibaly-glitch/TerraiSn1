import { useMemo } from "react";

export type AlerteProprietaire = {
  type: "danger" | "warning";
  terrain_nom: string;
  gerant_prenom?: string;
  message: string;
  lien: string | null;
  label_lien: string | null;
};

export type TerrainAlerteInput = {
  id?: number;
  nom: string;
  score_confiance?: number;
  occupation_mois?: number;
  gerant_id?: number | string | null;
  gerant_prenom?: string;
};

export function useAlertesProprietaire(terrainStats: TerrainAlerteInput[] | null | undefined) {
  return useMemo(() => {
    const alertes: AlerteProprietaire[] = [];
    for (const terrain of terrainStats || []) {
      if (Number(terrain.score_confiance ?? 100) < 50) {
        alertes.push({
          type: "danger",
          terrain_nom: terrain.nom,
          gerant_prenom: terrain.gerant_prenom,
          message: "Score de confiance bas ce mois",
          lien: "/backoffice/proprietaire/sante",
          label_lien: "Voir la santé",
        });
      }
      if (Number(terrain.occupation_mois ?? 100) < 40) {
        alertes.push({
          type: "warning",
          terrain_nom: terrain.nom,
          message: `Occupation faible ce mois (${Number(terrain.occupation_mois || 0)}%)`,
          lien: "/backoffice/proprietaire/revenus",
          label_lien: "Voir les revenus",
        });
      }
      if (!terrain.gerant_id) {
        alertes.push({
          type: "warning",
          terrain_nom: terrain.nom,
          message: "Aucun gérant assigné à ce terrain",
          lien: null,
          label_lien: null,
        });
      }
    }
    return alertes;
  }, [terrainStats]);
}
