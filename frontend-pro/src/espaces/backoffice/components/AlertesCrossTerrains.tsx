import { Bell, Clock, QrCode, Zap } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { gerantApi } from "@/lib/api";
import type { TerrainGerant } from "@/hooks/useTerrainActif";

type GerantOutletCtx = {
  terrainActif: number | null;
  terrains: TerrainGerant[];
  terrain: TerrainGerant | null;
  setTerrainActif: (terrain: TerrainGerant) => void;
};

type TerrainAlerte = {
  id: number;
  nom: string;
  quartier?: string;
  imminents_count: number;
  en_attente_scan: number;
  creneaux_libres_maintenant: number;
};

type AlerteItem = {
  key: string;
  terrain: TerrainAlerte;
  type: "imminent" | "scan" | "libre";
  message: string;
  urgence: "haute" | "normale";
  Icone: typeof Zap;
};

/**
 * Alertes sur les autres terrains du complexe (multi-terrains).
 * Clic → bascule le terrain actif via le contexte GerantLayout.
 */
export default function AlertesCrossTerrains() {
  const { terrains, terrain, setTerrainActif } = useOutletContext<GerantOutletCtx>();
  const [rows, setRows] = useState<TerrainAlerte[]>([]);
  const terrainActifId = terrain?.id ?? null;

  const load = useCallback(async () => {
    if (!terrains || terrains.length < 2) {
      setRows([]);
      return;
    }
    try {
      const payload = await gerantApi.terrainsAlertes();
      setRows(
        (payload.terrains || []).map((t) => ({
          id: Number(t.id),
          nom: t.nom,
          quartier: t.quartier,
          imminents_count: Number(t.imminents_count) || 0,
          en_attente_scan: Number(t.en_attente_scan) || 0,
          creneaux_libres_maintenant: Number(t.creneaux_libres_maintenant) || 0,
        })),
      );
    } catch {
      /* silencieux — le dashboard reste utilisable */
    }
  }, [terrains]);

  useEffect(() => {
    void load();
    if (!terrains || terrains.length < 2) return;
    const id = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(id);
  }, [load, terrains, terrainActifId]);

  const alertes = useMemo(() => {
    if (terrainActifId == null || rows.length < 2) return [] as AlerteItem[];

    return rows
      .filter((t) => t.id !== terrainActifId)
      .flatMap((t) => {
        const a: AlerteItem[] = [];
        if (t.imminents_count > 0) {
          a.push({
            key: `${t.id}-imminent`,
            terrain: t,
            type: "imminent",
            message: `${t.imminents_count} match${t.imminents_count > 1 ? "s" : ""} imminent${t.imminents_count > 1 ? "s" : ""}`,
            urgence: "haute",
            Icone: Zap,
          });
        }
        if (t.en_attente_scan > 0) {
          a.push({
            key: `${t.id}-scan`,
            terrain: t,
            type: "scan",
            message: `${t.en_attente_scan} QR à scanner`,
            urgence: "haute",
            Icone: QrCode,
          });
        }
        if (t.creneaux_libres_maintenant > 0) {
          a.push({
            key: `${t.id}-libre`,
            terrain: t,
            type: "libre",
            message: `${t.creneaux_libres_maintenant} créneau${t.creneaux_libres_maintenant > 1 ? "x" : ""} libre${t.creneaux_libres_maintenant > 1 ? "s" : ""}`,
            urgence: "normale",
            Icone: Clock,
          });
        }
        return a;
      });
  }, [rows, terrainActifId]);

  const switcherVersTerrain = (terrainId: number) => {
    const fromList = terrains.find((t) => t.id === terrainId);
    const fromAlertes = rows.find((t) => t.id === terrainId);
    const next: TerrainGerant = fromList
      ? fromList
      : {
          id: terrainId,
          nom: fromAlertes?.nom || `Terrain #${terrainId}`,
          quartier: fromAlertes?.quartier,
          imminent_count: fromAlertes?.imminents_count || 0,
        };
    setTerrainActif(next);
  };

  if (!terrains || terrains.length < 2 || alertes.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 px-0.5">
        <Bell className="w-3.5 h-3.5" style={{ color: "var(--g-warning)" }} />
        <span
          className="text-xs font-semibold uppercase tracking-wide"
          style={{ color: "var(--g-warning)" }}
        >
          Alertes — autres terrains du complexe
        </span>
      </div>

      <div className="flex flex-col gap-2">
        {alertes.map((alerte) => {
          const Icone = alerte.Icone;
          const haute = alerte.urgence === "haute";
          return (
            <button
              key={alerte.key}
              type="button"
              onClick={() => switcherVersTerrain(alerte.terrain.id)}
              className="flex items-center gap-3 p-3 rounded-xl text-left btn-press"
              style={{
                background: haute
                  ? "color-mix(in srgb, var(--g-warning) 12%, var(--g-surface))"
                  : "var(--g-surface-2)",
                border: `1px solid ${haute ? "var(--g-warning)" : "var(--g-border)"}`,
              }}
            >
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                style={{
                  background: haute ? "var(--g-warning)" : "var(--g-surface)",
                }}
              >
                <Icone
                  className="w-4 h-4"
                  style={{ color: haute ? "#fff" : "var(--g-text-2)" }}
                />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold truncate" style={{ color: "var(--g-text)" }}>
                  {alerte.terrain.nom}
                </p>
                <p className="text-xs" style={{ color: "var(--g-text-2)" }}>
                  {alerte.message}
                </p>
              </div>
              <span className="text-xs shrink-0" style={{ color: "var(--g-primary)" }}>
                Aller →
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
