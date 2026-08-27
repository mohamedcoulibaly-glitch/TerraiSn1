import { useEffect, useMemo, useState } from "react";
import { Loader2, Moon } from "lucide-react";
import { toast } from "sonner";
import { LucideByName } from "@/lib/lucideByName";
import { superAdminApi } from "@/services/superAdminApi";
import { estFermetureNuitProlongee } from "@/utils/creneauLabel";
import { optionsHeuresSelect2 } from "@/utils/heuresSelect2";
import Select2 from "@/components/Select2";

export type TerrainFeature = {
  cle: string;
  label: string;
  description: string;
  icone: string;
  defaut: boolean;
  impact: "joueur" | "gerant" | "proprio" | "global";
  actif: boolean;
};

const GROUPS: { impact: TerrainFeature["impact"]; label: string; color: string }[] = [
  { impact: "joueur", label: "Interface joueur", color: "var(--sa-info)" },
  { impact: "gerant", label: "Interface gérant", color: "var(--sa-success)" },
  { impact: "proprio", label: "Interface propriétaire", color: "var(--sa-warning)" },
];

type Props = {
  terrainId: number;
  features: TerrainFeature[];
  onSaved?: (next: TerrainFeature[]) => void;
};

export default function FeatureFlag({ terrainId, features, onSaved }: Props) {
  const [local, setLocal] = useState<TerrainFeature[]>(Array.isArray(features) ? features : []);
  const [saving, setSaving] = useState(false);
  const [fermetureMax, setFermetureMax] = useState("03:00");
  const [savingHoraires, setSavingHoraires] = useState(false);

  useEffect(() => {
    setLocal(Array.isArray(features) ? features : []);
  }, [features]);

  useEffect(() => {
    let cancelled = false;
    superAdminApi
      .getNuitProlongeeSettings?.()
      .then((data: any) => {
        if (cancelled) return;
        if (data?.heure_fermeture_maximale) setFermetureMax(String(data.heure_fermeture_maximale).slice(0, 5));
      })
      .catch(() => {
        try {
          const raw = localStorage.getItem("sa-nuit-prolongee-fermeture-max");
          if (raw) setFermetureMax(raw);
        } catch {
          /* ignore */
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const grouped = useMemo(
    () => GROUPS.map((g) => ({ ...g, items: local.filter((f) => f.impact === g.impact) })),
    [local],
  );

  async function save() {
    setSaving(true);
    try {
      const next = await superAdminApi.saveTerrainFeatures(
        terrainId,
        local.map((f) => ({ cle: f.cle, actif: f.actif })),
      );
      setLocal(next);
      onSaved?.(next);
      toast.success("Fonctionnalités enregistrées");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Enregistrement impossible");
    } finally {
      setSaving(false);
    }
  }

  async function saveHorairesNuit() {
    setSavingHoraires(true);
    try {
      if (superAdminApi.saveNuitProlongeeSettings) {
        await superAdminApi.saveNuitProlongeeSettings({ heure_fermeture_maximale: fermetureMax });
      }
      localStorage.setItem("sa-nuit-prolongee-fermeture-max", fermetureMax);
      toast.success("Horaires nuit prolongée enregistrés");
    } catch (err) {
      localStorage.setItem("sa-nuit-prolongee-fermeture-max", fermetureMax);
      toast.success("Préférence locale enregistrée");
    } finally {
      setSavingHoraires(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-[13px]" style={{ color: "var(--sa-muted)" }}>
        Activez ou désactivez les fonctionnalités pour ce terrain spécifiquement
      </p>

      <div
        className="rounded-xl p-4 space-y-3"
        style={{ background: "var(--sa-surface)", boxShadow: "var(--sa-shadow)" }}
      >
        <div className="flex items-center gap-2">
          <Moon size={16} style={{ color: "#4f46e5" }} />
          <span className="text-[13px] font-semibold" style={{ color: "var(--sa-text)" }}>
            Nuit prolongée ✦
          </span>
          {estFermetureNuitProlongee(fermetureMax) ? (
            <span
              className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
              style={{ background: "rgba(79,70,229,0.12)", color: "#4338ca" }}
            >
              Nuit prolongée ✦
            </span>
          ) : null}
        </div>

        <div
          className="rounded-lg px-3 py-2.5 text-[12px] flex items-start gap-2"
          style={{ background: "rgba(79,70,229,0.08)", color: "#4338ca" }}
        >
          <Moon size={14} className="shrink-0 mt-0.5" />
          <p>
            Les créneaux entre 00h00 et 04h59 sont affichés aux joueurs sous le label « Nuit du [jour
            précédent] » pour correspondre à l&apos;usage local au Sénégal. La date technique reste
            correcte en base de données.
          </p>
        </div>

        <label className="block space-y-1">
          <span className="text-[12px] font-medium" style={{ color: "var(--sa-muted)" }}>
            Heure de fermeture maximale autorisée
          </span>
          <Select2
            ariaLabel="Heure de fermeture maximale autorisée"
            value={fermetureMax}
            onChange={setFermetureMax}
            options={optionsHeuresSelect2(fermetureMax)}
          />
        </label>

        <label className="block space-y-1">
          <span className="text-[12px] font-medium" style={{ color: "var(--sa-muted)" }}>
            Heure de début des créneaux nuit prolongée
          </span>
          <input
            type="text"
            readOnly
            value="00h00 (minuit)"
            className="w-full min-h-[44px] rounded-lg px-3 text-[13px] opacity-70"
            style={{
              background: "var(--sa-surface-2)",
              color: "var(--sa-text)",
              border: "1px solid var(--sa-border)",
            }}
          />
        </label>

        <button
          type="button"
          disabled={savingHoraires}
          onClick={saveHorairesNuit}
          className="min-h-[40px] px-3 rounded-lg text-[12px] font-semibold text-white inline-flex items-center gap-2"
          style={{ background: "#4f46e5" }}
        >
          {savingHoraires ? <Loader2 size={14} className="animate-spin" /> : null}
          Enregistrer horaires nuit
        </button>
      </div>

      {grouped.map((g) => (
        <div
          key={g.impact}
          className="rounded-xl p-4 space-y-3"
          style={{ background: "var(--sa-surface)", boxShadow: "var(--sa-shadow)" }}
        >
          <span
            className="inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold"
            style={{ color: g.color, background: "var(--sa-surface-2)" }}
          >
            {g.label}
          </span>
          {g.items.map((f) => (
            <label
              key={f.cle}
              className="flex items-start gap-3 py-2"
              style={{ borderTop: "1px solid var(--sa-border)" }}
            >
              <LucideByName
                name={f.icone}
                size={18}
                className="mt-0.5 shrink-0"
                style={{ color: "var(--sa-primary)" }}
              />
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold" style={{ color: "var(--sa-text)" }}>
                  {f.label}
                </p>
                <p className="text-[12px]" style={{ color: "var(--sa-muted)" }}>
                  {f.description}
                </p>
              </div>
              <input
                type="checkbox"
                checked={Boolean(f.actif)}
                onChange={(e) =>
                  setLocal((prev) =>
                    prev.map((x) => (x.cle === f.cle ? { ...x, actif: e.target.checked } : x)),
                  )
                }
                className="mt-1 h-5 w-5"
              />
            </label>
          ))}
        </div>
      ))}
      <button
        type="button"
        disabled={saving}
        onClick={save}
        className="min-h-[44px] px-4 rounded-lg text-[13px] font-semibold text-white inline-flex items-center gap-2"
        style={{ background: "var(--sa-primary)" }}
      >
        {saving ? <Loader2 size={14} className="animate-spin" /> : null}
        Enregistrer les fonctionnalités
      </button>
    </div>
  );
}
