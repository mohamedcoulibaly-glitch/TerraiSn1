import { useEffect, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { superAdminApi } from "@/services/superAdminApi";

export type TerrainFormatRow = {
  id?: number;
  cle: string;
  label: string;
  prix_heure: number;
  map_grille?: "demi" | "entier" | null;
  ordre?: number;
  actif?: boolean;
};

export type TerrainDureeRow = {
  id?: number;
  minutes: number;
  label: string;
  ordre?: number;
  actif?: boolean;
};

type Props = {
  terrainId: number;
};

function money(n: number) {
  return `${Number(n || 0).toLocaleString("fr-FR")} FCFA`;
}

export default function FormatsTerrainEditor({ terrainId }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formats, setFormats] = useState<TerrainFormatRow[]>([]);
  const [durees, setDurees] = useState<TerrainDureeRow[]>([]);

  const load = () => {
    setLoading(true);
    superAdminApi
      .terrainFormats(terrainId)
      .then((data) => {
        setFormats(Array.isArray(data?.formats) ? data.formats : []);
        setDurees(Array.isArray(data?.durees) ? data.durees : []);
      })
      .catch((err) => toast.error(err instanceof Error ? err.message : "Chargement impossible"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [terrainId]);

  const save = async () => {
    if (!formats.some((f) => f.actif !== false && Number(f.prix_heure) > 0)) {
      toast.error("Au moins un format actif avec un prix > 0");
      return;
    }
    if (!durees.some((d) => d.actif !== false && Number(d.minutes) > 0)) {
      toast.error("Au moins une durée active");
      return;
    }
    setSaving(true);
    try {
      const result = await superAdminApi.saveTerrainFormats(terrainId, { formats, durees });
      setFormats(Array.isArray(result?.formats) ? result.formats : formats);
      setDurees(Array.isArray(result?.durees) ? result.durees : durees);
      toast.success("Formats et durées enregistrés — visibles joueur / gérant");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Enregistrement impossible");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-xl p-8 grid place-items-center" style={{ background: "var(--sa-surface)" }}>
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: "var(--sa-muted)" }} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section className="rounded-xl p-4 space-y-3" style={{ background: "var(--sa-surface)", boxShadow: "var(--sa-shadow)" }}>
        <div>
          <h2 className="text-sm font-semibold" style={{ color: "var(--sa-text)" }}>
            Formats de terrain (liés au prix / h)
          </h2>
          <p className="text-[12px] mt-1" style={{ color: "var(--sa-muted)" }}>
            Ex. Demi-terrain, Terrain entier, 5v5… Les clés <code>moitie</code> / <code>entier</code> restent
            synchronisées avec la grille classique.
          </p>
        </div>

        <div className="space-y-2">
          {formats.map((f, idx) => (
            <div
              key={`${f.cle}-${idx}`}
              className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end rounded-lg p-3"
              style={{ background: "var(--sa-surface-2)" }}
            >
              <label className="sm:col-span-3 block">
                <span className="text-[11px]" style={{ color: "var(--sa-muted)" }}>
                  Libellé
                </span>
                <input
                  value={f.label}
                  onChange={(e) => {
                    const label = e.target.value;
                    setFormats((prev) =>
                      prev.map((row, i) =>
                        i === idx
                          ? {
                              ...row,
                              label,
                              cle:
                                row.cle === "moitie" || row.cle === "entier"
                                  ? row.cle
                                  : row.cle || label,
                            }
                          : row,
                      ),
                    );
                  }}
                  className="mt-1 h-10 w-full rounded-lg px-2 text-sm"
                  style={{ border: "1px solid var(--sa-border)", background: "var(--sa-surface)" }}
                />
              </label>
              <label className="sm:col-span-2 block">
                <span className="text-[11px]" style={{ color: "var(--sa-muted)" }}>
                  Clé
                </span>
                <input
                  value={f.cle}
                  disabled={f.cle === "moitie" || f.cle === "entier"}
                  onChange={(e) =>
                    setFormats((prev) =>
                      prev.map((row, i) => (i === idx ? { ...row, cle: e.target.value } : row)),
                    )
                  }
                  className="mt-1 h-10 w-full rounded-lg px-2 text-sm disabled:opacity-60"
                  style={{ border: "1px solid var(--sa-border)", background: "var(--sa-surface)" }}
                />
              </label>
              <label className="sm:col-span-2 block">
                <span className="text-[11px]" style={{ color: "var(--sa-muted)" }}>
                  Prix / h
                </span>
                <input
                  type="number"
                  min={0}
                  step={500}
                  value={f.prix_heure || ""}
                  onChange={(e) =>
                    setFormats((prev) =>
                      prev.map((row, i) =>
                        i === idx ? { ...row, prix_heure: Number(e.target.value) || 0 } : row,
                      ),
                    )
                  }
                  className="mt-1 h-10 w-full rounded-lg px-2 text-sm"
                  style={{ border: "1px solid var(--sa-border)", background: "var(--sa-surface)" }}
                />
              </label>
              <label className="sm:col-span-2 block">
                <span className="text-[11px]" style={{ color: "var(--sa-muted)" }}>
                  Grille
                </span>
                <select
                  value={f.map_grille || ""}
                  onChange={(e) =>
                    setFormats((prev) =>
                      prev.map((row, i) =>
                        i === idx
                          ? {
                              ...row,
                              map_grille: (e.target.value || null) as "demi" | "entier" | null,
                            }
                          : row,
                      ),
                    )
                  }
                  className="mt-1 h-10 w-full rounded-lg px-2 text-sm"
                  style={{ border: "1px solid var(--sa-border)", background: "var(--sa-surface)" }}
                >
                  <option value="">Prix fixe format</option>
                  <option value="demi">→ Demi (grille)</option>
                  <option value="entier">→ Entier (grille)</option>
                </select>
              </label>
              <label className="sm:col-span-2 flex items-center gap-2 min-h-[40px]">
                <input
                  type="checkbox"
                  checked={f.actif !== false}
                  onChange={(e) =>
                    setFormats((prev) =>
                      prev.map((row, i) => (i === idx ? { ...row, actif: e.target.checked } : row)),
                    )
                  }
                />
                <span className="text-xs" style={{ color: "var(--sa-text)" }}>
                  Actif
                </span>
              </label>
              <button
                type="button"
                className="sm:col-span-1 h-10 rounded-lg inline-flex items-center justify-center"
                style={{ color: "var(--sa-danger)", border: "1px solid var(--sa-border)" }}
                onClick={() => setFormats((prev) => prev.filter((_, i) => i !== idx))}
                aria-label="Supprimer format"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={() =>
            setFormats((prev) => [
              ...prev,
              {
                cle: `format_${prev.length + 1}`,
                label: "Nouveau format",
                prix_heure: 0,
                map_grille: null,
                ordre: prev.length,
                actif: true,
              },
            ])
          }
          className="min-h-[40px] px-3 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5"
          style={{ border: "1px dashed var(--sa-border)", color: "var(--sa-primary)" }}
        >
          <Plus className="w-4 h-4" /> Ajouter un format
        </button>
      </section>

      <section className="rounded-xl p-4 space-y-3" style={{ background: "var(--sa-surface)", boxShadow: "var(--sa-shadow)" }}>
        <div>
          <h2 className="text-sm font-semibold" style={{ color: "var(--sa-text)" }}>
            Durées de match proposées
          </h2>
          <p className="text-[12px] mt-1" style={{ color: "var(--sa-muted)" }}>
            Ces durées s&apos;affichent sur la fiche joueur et la réservation express gérant.
          </p>
        </div>
        <div className="space-y-2">
          {durees.map((d, idx) => (
            <div
              key={`${d.minutes}-${idx}`}
              className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end rounded-lg p-3"
              style={{ background: "var(--sa-surface-2)" }}
            >
              <label className="sm:col-span-3 block">
                <span className="text-[11px]" style={{ color: "var(--sa-muted)" }}>
                  Minutes
                </span>
                <input
                  type="number"
                  min={15}
                  step={15}
                  value={d.minutes || ""}
                  onChange={(e) =>
                    setDurees((prev) =>
                      prev.map((row, i) =>
                        i === idx ? { ...row, minutes: Number(e.target.value) || 0 } : row,
                      ),
                    )
                  }
                  className="mt-1 h-10 w-full rounded-lg px-2 text-sm"
                  style={{ border: "1px solid var(--sa-border)", background: "var(--sa-surface)" }}
                />
              </label>
              <label className="sm:col-span-4 block">
                <span className="text-[11px]" style={{ color: "var(--sa-muted)" }}>
                  Libellé
                </span>
                <input
                  value={d.label}
                  onChange={(e) =>
                    setDurees((prev) =>
                      prev.map((row, i) => (i === idx ? { ...row, label: e.target.value } : row)),
                    )
                  }
                  className="mt-1 h-10 w-full rounded-lg px-2 text-sm"
                  style={{ border: "1px solid var(--sa-border)", background: "var(--sa-surface)" }}
                />
              </label>
              <label className="sm:col-span-3 flex items-center gap-2 min-h-[40px]">
                <input
                  type="checkbox"
                  checked={d.actif !== false}
                  onChange={(e) =>
                    setDurees((prev) =>
                      prev.map((row, i) => (i === idx ? { ...row, actif: e.target.checked } : row)),
                    )
                  }
                />
                <span className="text-xs">Actif</span>
              </label>
              <button
                type="button"
                className="sm:col-span-2 h-10 rounded-lg inline-flex items-center justify-center gap-1 text-xs font-medium"
                style={{ color: "var(--sa-danger)", border: "1px solid var(--sa-border)" }}
                onClick={() => setDurees((prev) => prev.filter((_, i) => i !== idx))}
              >
                <Trash2 className="w-4 h-4" /> Retirer
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() =>
            setDurees((prev) => [
              ...prev,
              { minutes: 60, label: "1h", ordre: prev.length, actif: true },
            ])
          }
          className="min-h-[40px] px-3 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5"
          style={{ border: "1px dashed var(--sa-border)", color: "var(--sa-primary)" }}
        >
          <Plus className="w-4 h-4" /> Ajouter une durée
        </button>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[12px]" style={{ color: "var(--sa-muted)" }}>
          Aperçu :{" "}
          {formats
            .filter((f) => f.actif !== false)
            .map((f) => `${f.label} ${money(f.prix_heure)}/h`)
            .join(" · ") || "—"}
        </p>
        <button
          type="button"
          disabled={saving}
          onClick={() => void save()}
          className="min-h-[44px] px-5 rounded-lg text-sm font-semibold text-white inline-flex items-center gap-2"
          style={{ background: "var(--sa-primary)", opacity: saving ? 0.7 : 1 }}
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          Enregistrer formats & durées
        </button>
      </div>
    </div>
  );
}
