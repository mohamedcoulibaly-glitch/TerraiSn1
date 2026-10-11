import { useCallback, useEffect, useMemo, useState } from "react";
import { User } from "lucide-react";
import { employesApi, proprietaireApi } from "@/lib/api";
import ProprioEmptyState from "@/espaces/backoffice/components/ProprioEmptyState";
import { formatFcfa, gerantNomComplet, proprioTerrainPhoto } from "@/espaces/backoffice/proprietaire/proprioUtils";

type Terrain = {
  id: number;
  nom: string;
  ville?: string;
  quartier?: string;
  is_active?: number | boolean | string;
  photos?: unknown;
  prix_entier?: number;
  prix_heure?: number;
  prix_moitie?: number;
};

export default function MesTerrains() {
  const [terrains, setTerrains] = useState<Terrain[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [employes, setEmployes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [t, s, e] = await Promise.all([
        proprietaireApi.terrains(),
        proprietaireApi.stats().catch(() => null),
        employesApi.list().catch(() => []),
      ]);
      setTerrains(Array.isArray(t) ? t : []);
      setStats(s);
      setEmployes(Array.isArray(e) ? e : []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const gerantByTerrain = useMemo(() => {
    const map: Record<string, any> = {};
    for (const e of employes) {
      if (e.terrain_id == null) continue;
      const key = String(e.terrain_id);
      if (!map[key] && Number(e.is_active) !== 0) map[key] = e;
    }
    return map;
  }, [employes]);

  if (loading) {
    return (
      <div className="space-y-3 max-w-5xl mx-auto animate-pulse">
        <div className="h-8 w-48 rounded-lg" style={{ background: "var(--p-surface-2)" }} />
        {[1, 2].map((i) => (
          <div key={i} className="h-40 rounded-2xl" style={{ background: "var(--p-surface-2)" }} />
        ))}
      </div>
    );
  }

  if (!terrains.length) {
    return (
      <ProprioEmptyState
        title="Aucun terrain associé à ton compte"
        subtitle="Contacte l'administration pour en ajouter un."
      />
    );
  }

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      <div className="flex items-center gap-2">
        <h1 className="text-lg font-semibold" style={{ fontFamily: "var(--font-display)", color: "var(--p-text)" }}>
          Mes terrains
        </h1>
        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: "var(--p-surface-2)", color: "var(--p-muted)" }}>
          {terrains.length}
        </span>
      </div>

      <div className="space-y-3">
        {terrains.map((t) => {
          const active = t.is_active === 1 || t.is_active === true || t.is_active === "1";
          const gerant = gerantByTerrain[String(t.id)];
          const row = (stats?.terrainStats || []).find((s: any) => Number(s.id) === Number(t.id));
          const prixEntier = Number(t.prix_entier || t.prix_heure || 0);
          const prixMoitie = Number(t.prix_moitie || Math.round(prixEntier * 0.6));
          return (
            <article
              key={t.id}
              className="rounded-2xl p-4"
              style={{ background: "var(--p-surface)", boxShadow: "var(--p-shadow)" }}
            >
              <div className="flex items-start gap-3">
                <img
                  src={proprioTerrainPhoto(t)}
                  alt=""
                  className="w-14 h-14 rounded-lg object-cover shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-semibold truncate" style={{ color: "var(--p-text)" }}>{t.nom}</p>
                  <p className="text-[12px] truncate" style={{ color: "var(--p-muted)" }}>{t.ville || t.quartier || "—"}</p>
                </div>
                <span
                  className="text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0"
                  style={{
                    background: active ? "var(--p-optimal-bg)" : "var(--p-surface-2)",
                    color: active ? "var(--p-optimal)" : "var(--p-muted)",
                  }}
                >
                  {active ? "Ouvert" : "Fermé"}
                </span>
              </div>

              <div className="mt-3 flex items-center gap-2 text-[13px]" style={{ color: "var(--p-text-2)" }}>
                <User className="w-3.5 h-3.5" style={{ color: "var(--p-muted)" }} />
                {gerant ? (
                  <span>Gérant : {gerantNomComplet(gerant)}</span>
                ) : (
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: "var(--p-attention-bg)", color: "var(--p-attention)" }}>
                    Aucun gérant assigné
                  </span>
                )}
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5">
                <span className="text-[11px] px-2.5 py-1 rounded-full" style={{ background: "var(--p-surface-2)", color: "var(--p-text-2)" }}>
                  Entier : {prixEntier.toLocaleString("fr-FR")} FCFA / h
                </span>
                <span className="text-[11px] px-2.5 py-1 rounded-full" style={{ background: "var(--p-surface-2)", color: "var(--p-text-2)" }}>
                  Demi : {prixMoitie.toLocaleString("fr-FR")} FCFA / h
                </span>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-xl px-2 py-2" style={{ background: "var(--p-surface-2)" }}>
                  <p className="text-sm font-bold" style={{ color: "var(--p-text)" }}>{Number(row?.occupancy || 0)}%</p>
                  <p className="text-[10px]" style={{ color: "var(--p-muted)" }}>Occupation</p>
                </div>
                <div className="rounded-xl px-2 py-2" style={{ background: "var(--p-surface-2)" }}>
                  <p className="text-sm font-bold" style={{ color: "var(--p-text)" }}>{Number(row?.matchsJoues || 0)}</p>
                  <p className="text-[10px]" style={{ color: "var(--p-muted)" }}>Matchs</p>
                </div>
                <div className="rounded-xl px-2 py-2" style={{ background: "var(--p-surface-2)" }}>
                  <p className="text-sm font-bold tabular-nums" style={{ color: "var(--p-text)" }}>
                    {formatFcfa(row?.revenue).replace(" FCFA", "")}
                  </p>
                  <p className="text-[10px]" style={{ color: "var(--p-muted)" }}>CA du mois</p>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
