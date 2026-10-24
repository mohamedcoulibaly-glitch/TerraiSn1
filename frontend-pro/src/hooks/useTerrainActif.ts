import { useCallback, useEffect, useState } from "react";
import {
  gerantApi,
  getGerantTerrainActif,
  setGerantTerrainActif,
} from "@/lib/api";

export type TerrainGerant = {
  id: number;
  nom: string;
  adresse?: string;
  ville?: string;
  quartier?: string;
  photo_principale?: string | null;
  matchs_aujourd_hui?: number;
  imminent_count?: number;
  imminents_count?: number;
  en_attente_scan?: number;
  creneaux_libres_maintenant?: number;
  site_id?: number | null;
  est_principal?: number;
  note?: string | null;
  actif?: number;
};

function normalizeTerrain(raw: TerrainGerant): TerrainGerant {
  const imminent =
    Number(raw.imminent_count ?? raw.imminents_count) || 0;
  return {
    ...raw,
    id: Number(raw.id),
    quartier: raw.quartier || raw.adresse || raw.ville || "",
    photo_principale: raw.photo_principale || null,
    matchs_aujourd_hui: Number(raw.matchs_aujourd_hui) || 0,
    imminent_count: imminent,
    imminents_count: imminent,
    en_attente_scan: Number(raw.en_attente_scan) || 0,
    creneaux_libres_maintenant: Number(raw.creneaux_libres_maintenant) || 0,
    site_id: raw.site_id != null ? Number(raw.site_id) : null,
  };
}

/**
 * Terrain actif du gérant (multi-terrains).
 * Persistance localStorage via `gerant_terrain_actif` (+ header X-Terrain-Id).
 */
export function useTerrainActif() {
  const [terrains, setTerrains] = useState<TerrainGerant[]>([]);
  const [terrainActif, setTerrainActifState] = useState<TerrainGerant | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const setTerrainActif = useCallback((terrain: TerrainGerant) => {
    const normalized = normalizeTerrain(terrain);
    setTerrainActifState(normalized);
    setGerantTerrainActif(normalized.id);
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await gerantApi.terrains();
      const list = (Array.isArray(payload?.terrains) ? payload.terrains : []).map(normalizeTerrain);
      setTerrains(list);

      const ids = list.map((t) => t.id);
      const saved = getGerantTerrainActif();
      const fromPayload =
        payload.terrain_actif != null && ids.includes(Number(payload.terrain_actif))
          ? Number(payload.terrain_actif)
          : null;
      const initialId =
        (saved && ids.includes(saved) ? saved : null) || fromPayload || ids[0] || null;

      if (initialId != null) {
        const found = list.find((t) => t.id === initialId) || list[0];
        if (found) {
          setTerrainActifState(found);
          setGerantTerrainActif(found.id);
        }
      } else {
        setTerrainActifState(null);
      }
    } catch {
      setError("Impossible de charger tes terrains.");
      setTerrains([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return {
    terrains,
    terrainActif,
    setTerrainActif,
    loading,
    error,
    reload,
  };
}
