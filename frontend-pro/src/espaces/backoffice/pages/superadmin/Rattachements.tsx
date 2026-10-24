import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Link2, MapPin, MousePointer2 } from "lucide-react";
import { toast } from "sonner";
import SaPageHeader from "@/espaces/backoffice/components/superadmin/ui/SaPageHeader";
import Select2 from "@/components/Select2";
import GerantsTerrainTab from "@/espaces/backoffice/components/superadmin/GerantsTerrainTab";
import { superAdminApi } from "@/services/superAdminApi";
import { useSaCrumbs } from "@/espaces/backoffice/layout/SuperadminLayout";

type TerrainRow = {
  id: number;
  nom: string;
  ville?: string;
  proprietaire_id?: number;
  proprietaire_nom?: string | null;
  gerant_principal_nom?: string | null;
  nb_gerants?: number;
  site_id?: number | null;
  site_nom?: string | null;
};

/**
 * Façade rattachements — réutilise GerantsTerrainTab + PATCH rattachement.
 * Pas de nouveau modèle de données.
 */
export default function Rattachements() {
  useSaCrumbs([{ label: "Rattachements", to: "/backoffice/superadmin/rattachements" }]);
  const [terrains, setTerrains] = useState<TerrainRow[]>([]);
  const [owners, setOwners] = useState<Array<{ id: number; nom: string }>>([]);
  const [sites, setSites] = useState<Array<{ id: number; nom: string }>>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const [t, u] = await Promise.all([
      superAdminApi.terrains(),
      superAdminApi.users().catch(() => []),
    ]);
    setTerrains(Array.isArray(t) ? t : []);
    setOwners(
      (Array.isArray(u) ? u : [])
        .filter((x: any) => x.role === "proprietaire")
        .map((x: any) => ({ id: Number(x.id), nom: x.nom })),
    );
  };

  useEffect(() => {
    load().catch((err) => toast.error(err instanceof Error ? err.message : "Chargement impossible"));
  }, []);

  const selected = useMemo(
    () => terrains.find((t) => Number(t.id) === Number(selectedId)) || null,
    [terrains, selectedId],
  );

  useEffect(() => {
    if (!selected?.proprietaire_id) {
      setSites([]);
      return;
    }
    superAdminApi
      .sites({ proprietaire_id: selected.proprietaire_id })
      .then((p) => setSites(Array.isArray(p?.sites) ? p.sites : []))
      .catch(() => setSites([]));
  }, [selected?.proprietaire_id, selected?.id]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return terrains;
    return terrains.filter((t) =>
      `${t.nom} ${t.ville || ""} ${t.proprietaire_nom || ""} ${t.gerant_principal_nom || ""}`
        .toLowerCase()
        .includes(needle),
    );
  }, [terrains, q]);

  const incomplete = (t: TerrainRow) =>
    !t.proprietaire_nom || !String(t.gerant_principal_nom || "").trim() || Number(t.nb_gerants || 0) < 1;

  async function saveRattachement(patch: { proprietaire_id?: number; site_id?: number | null }) {
    if (!selected) return;
    setSaving(true);
    try {
      await superAdminApi.patchTerrainRattachement(selected.id, patch);
      toast.success("Rattachement mis à jour");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Mise à jour impossible");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5 max-w-[1200px]">
      <SaPageHeader
        titre="Rattachements"
        sousTitre="Associations rapides terrain ↔ propriétaire ↔ gérants (APIs admin existantes)"
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div
          className="rounded-xl overflow-hidden lg:col-span-1"
          style={{ background: "var(--sa-surface)", boxShadow: "var(--sa-shadow)" }}
        >
          <div
            className="px-4 py-3 flex items-center justify-between gap-2"
            style={{ borderBottom: "1px solid var(--sa-border)" }}
          >
            <h3 className="text-sm font-semibold flex items-center gap-2" style={{ color: "var(--sa-text)" }}>
              <Link2 className="w-4 h-4" style={{ color: "var(--sa-primary)" }} />
              Terrains
            </h3>
            <span
              className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
              style={{ background: "var(--sa-surface-2)", color: "var(--sa-muted)" }}
            >
              {filtered.length}
            </span>
          </div>
          <div className="p-3">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Rechercher…"
              className="sa-input w-full"
            />
          </div>
          <div className="max-h-[60vh] overflow-auto">
            {filtered.map((t) => {
              const active = Number(selectedId) === Number(t.id);
              const warn = incomplete(t);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setSelectedId(t.id)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left"
                  style={{
                    background: active ? "var(--sa-primary-glow)" : "transparent",
                    borderBottom: "1px solid var(--sa-border)",
                  }}
                >
                  <MapPin className="w-4 h-4 shrink-0" style={{ color: "var(--sa-primary)" }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: "var(--sa-text)" }}>
                      {t.nom}
                    </p>
                    <p className="text-xs truncate" style={{ color: "var(--sa-muted)" }}>
                      {t.gerant_principal_nom?.trim() || "Sans gérant"}
                      {" · "}
                      {t.proprietaire_nom || "Sans propriétaire"}
                    </p>
                  </div>
                  {warn ? (
                    <AlertTriangle className="w-4 h-4 shrink-0" style={{ color: "var(--sa-warning)" }} />
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>

        <div className="lg:col-span-2 space-y-4">
          {!selected ? (
            <div
              className="rounded-xl flex items-center justify-center min-h-[220px]"
              style={{ background: "var(--sa-surface)", boxShadow: "var(--sa-shadow)" }}
            >
              <div className="text-center px-6">
                <MousePointer2 className="w-8 h-8 mx-auto mb-2" style={{ color: "var(--sa-muted)" }} />
                <p className="text-sm" style={{ color: "var(--sa-muted)" }}>
                  Sélectionne un terrain pour gérer ses rattachements
                </p>
              </div>
            </div>
          ) : (
            <>
              <div
                className="rounded-xl p-4 space-y-4"
                style={{ background: "var(--sa-surface)", boxShadow: "var(--sa-shadow)" }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-[15px] font-semibold" style={{ color: "var(--sa-text)" }}>
                      {selected.nom}
                    </h3>
                    <p className="text-xs mt-0.5" style={{ color: "var(--sa-muted)" }}>
                      {selected.ville || "—"}
                      {selected.site_nom ? ` · ${selected.site_nom}` : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedId(null)}
                    className="text-xs font-semibold"
                    style={{ color: "var(--sa-muted)" }}
                  >
                    Fermer
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="block">
                    <span className="text-[12px] font-medium" style={{ color: "var(--sa-text-2)" }}>
                      Propriétaire
                    </span>
                    <div className="mt-1">
                      <Select2
                        value={selected.proprietaire_id ? String(selected.proprietaire_id) : ""}
                        disabled={saving}
                        placeholder="Choisir"
                        options={owners.map((o) => ({ value: String(o.id), label: o.nom }))}
                        onChange={(v) => {
                          if (!v) return;
                          void saveRattachement({ proprietaire_id: Number(v) });
                        }}
                      />
                    </div>
                  </label>
                  <label className="block">
                    <span className="text-[12px] font-medium" style={{ color: "var(--sa-text-2)" }}>
                      Complexe (site)
                    </span>
                    <div className="mt-1">
                      <Select2
                        value={selected.site_id != null ? String(selected.site_id) : ""}
                        disabled={saving || !selected.proprietaire_id}
                        placeholder="Hors complexe"
                        options={[
                          { value: "", label: "Hors complexe" },
                          ...sites.map((s) => ({ value: String(s.id), label: s.nom })),
                        ]}
                        onChange={(v) => {
                          void saveRattachement({
                            site_id: v ? Number(v) : null,
                          });
                        }}
                      />
                    </div>
                  </label>
                </div>
              </div>

              <GerantsTerrainTab
                terrainId={selected.id}
                terrainNom={selected.nom}
                onChanged={() => {
                  void load();
                }}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
