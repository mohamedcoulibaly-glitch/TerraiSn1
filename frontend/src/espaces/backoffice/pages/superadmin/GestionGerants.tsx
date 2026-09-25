import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Loader2, UserCog, Users } from "lucide-react";
import { toast } from "sonner";
import { superAdminApi, type TerrainGerant } from "@/services/superAdminApi";
import { useSaCrumbs } from "@/espaces/backoffice/layout/SuperadminLayout";
import SaPageHeader from "@/espaces/backoffice/components/superadmin/ui/SaPageHeader";
import SaEmptyState from "@/espaces/backoffice/components/superadmin/ui/SaEmptyState";
import GerantsTerrainTab from "@/espaces/backoffice/components/superadmin/GerantsTerrainTab";

type TerrainRow = {
  id: number;
  nom: string;
  ville?: string | null;
  is_active?: number | boolean;
};

type TerrainSummary = TerrainRow & {
  nb_gerants: number;
  principal_nom: string | null;
  garde_nom: string | null;
};

export default function GestionGerants() {
  useSaCrumbs([
    { label: "Utilisateurs", to: "/backoffice/superadmin/utilisateurs" },
    { label: "Gérants", to: "/backoffice/superadmin/gerants" },
  ]);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = Number(searchParams.get("terrain") || 0) || null;

  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<TerrainSummary[]>([]);

  const load = async () => {
    setLoading(true);
    try {
      const terrainsRaw = await superAdminApi.terrains();
      const terrains: TerrainRow[] = (Array.isArray(terrainsRaw) ? terrainsRaw : []).map((t: any) => ({
        id: Number(t.id),
        nom: String(t.nom || "Terrain"),
        ville: t.ville,
        is_active: t.is_active,
      }));

      const summaries = await Promise.all(
        terrains.map(async (t) => {
          try {
            const data = await superAdminApi.terrainGerants(t.id);
            const gerants: TerrainGerant[] = Array.isArray(data?.gerants) ? data.gerants : [];
            const actifs = gerants.filter((g) => Number(g.actif) === 1);
            const principal = actifs.find((g) => Number(g.est_principal) === 1) || actifs[0];
            const garde = data?.garde_actuelle;
            return {
              ...t,
              nb_gerants: actifs.length,
              principal_nom: principal
                ? [principal.prenom, principal.nom].filter(Boolean).join(" ") || principal.nom || null
                : null,
              garde_nom: garde
                ? [garde.prenom, garde.nom].filter(Boolean).join(" ") || garde.nom || null
                : null,
            } as TerrainSummary;
          } catch {
            return {
              ...t,
              nb_gerants: 0,
              principal_nom: null,
              garde_nom: null,
            } as TerrainSummary;
          }
        }),
      );
      setRows(summaries);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Impossible de charger les terrains");
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((r) =>
      `${r.nom} ${r.ville || ""} ${r.principal_nom || ""}`.toLowerCase().includes(term),
    );
  }, [rows, q]);

  const selected = rows.find((r) => r.id === selectedId) || null;

  function selectTerrain(id: number) {
    setSearchParams({ terrain: String(id) });
  }

  return (
    <div className="space-y-5 max-w-[1200px]">
      <SaPageHeader
        titre="Gérants des terrains"
        sousTitre="Assignez un ou plusieurs gérants par terrain, définissez le principal et le planning de garde"
      />

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4 items-start">
        <aside
          className="rounded-xl overflow-hidden"
          style={{ background: "var(--sa-surface)", boxShadow: "var(--sa-shadow)" }}
        >
          <div className="p-3" style={{ borderBottom: "1px solid var(--sa-border)" }}>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Rechercher un terrain…"
              className="sa-input w-full"
            />
          </div>

          {loading ? (
            <div className="p-6 flex items-center gap-2 text-sm" style={{ color: "var(--sa-muted)" }}>
              <Loader2 size={16} className="animate-spin" /> Chargement…
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-4">
              <SaEmptyState
                icon={Users}
                titre="Aucun terrain"
                description="Créez d'abord un terrain pour y rattacher des gérants."
                action={
                  <button
                    type="button"
                    className="sa-btn sa-btn-primary sa-btn-sm"
                    onClick={() => navigate("/backoffice/superadmin/terrains")}
                  >
                    Voir les terrains
                  </button>
                }
              />
            </div>
          ) : (
            <ul className="max-h-[70vh] overflow-auto divide-y" style={{ borderColor: "var(--sa-border)" }}>
              {filtered.map((t) => {
                const active = selectedId === t.id;
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => selectTerrain(t.id)}
                      className="w-full text-left px-3 py-3 transition-colors"
                      style={{
                        background: active ? "var(--sa-primary-glow, var(--sa-surface-2))" : "transparent",
                        borderLeft: active ? "3px solid var(--sa-primary)" : "3px solid transparent",
                      }}
                    >
                      <p className="text-[13px] font-semibold truncate" style={{ color: "var(--sa-text)" }}>
                        {t.nom}
                      </p>
                      <p className="text-[11px] mt-0.5 truncate" style={{ color: "var(--sa-muted)" }}>
                        {t.ville || "—"} · {t.nb_gerants} gérant{t.nb_gerants > 1 ? "s" : ""}
                      </p>
                      <p className="text-[11px] mt-1 truncate" style={{ color: "var(--sa-text-2)" }}>
                        {t.principal_nom
                          ? `Principal : ${t.principal_nom}`
                          : "Aucun gérant assigné"}
                      </p>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        <section>
          {!selectedId ? (
            <div
              className="rounded-xl p-8 flex flex-col items-center justify-center text-center gap-3 min-h-[320px]"
              style={{ background: "var(--sa-surface)", boxShadow: "var(--sa-shadow)" }}
            >
              <div
                className="w-12 h-12 rounded-full inline-flex items-center justify-center"
                style={{ background: "var(--sa-surface-2)", color: "var(--sa-primary)" }}
              >
                <UserCog size={22} />
              </div>
              <h2 className="text-[16px] font-semibold" style={{ color: "var(--sa-text)" }}>
                Sélectionne un terrain
              </h2>
              <p className="text-[13px] max-w-sm" style={{ color: "var(--sa-muted)" }}>
                Puis ajoute, active ou retire des gérants, définis le principal et configure le planning de garde.
              </p>
            </div>
          ) : selected ? (
            <div className="space-y-3">
              <div
                className="rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-2"
                style={{ background: "var(--sa-surface)", boxShadow: "var(--sa-shadow)" }}
              >
                <div>
                  <p className="text-[15px] font-semibold" style={{ color: "var(--sa-text)" }}>
                    {selected.nom}
                  </p>
                  <p className="text-[12px]" style={{ color: "var(--sa-muted)" }}>
                    {selected.nb_gerants} gérant{selected.nb_gerants > 1 ? "s" : ""}
                    {selected.garde_nom ? ` · De garde : ${selected.garde_nom}` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  className="sa-btn sa-btn-secondary sa-btn-sm inline-flex items-center gap-1.5"
                  onClick={() => navigate(`/backoffice/superadmin/terrains/${selected.id}?tab=gerants`)}
                >
                  <Users size={14} />
                  Ouvrir la fiche terrain
                </button>
              </div>
              <GerantsTerrainTab
                key={selected.id}
                terrainId={selected.id}
                terrainNom={selected.nom}
                onChanged={() => {
                  void load();
                }}
              />
            </div>
          ) : (
            <div className="rounded-xl p-6 text-sm" style={{ background: "var(--sa-surface)", color: "var(--sa-muted)" }}>
              Terrain introuvable.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
