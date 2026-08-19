import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { LucideByName } from "@/lib/lucideByName";
import { superAdminApi } from "@/services/superAdminApi";

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

  useEffect(() => {
    setLocal(Array.isArray(features) ? features : []);
  }, [features]);

  const grouped = useMemo(() => GROUPS.map((g) => ({ ...g, items: local.filter((f) => f.impact === g.impact) })), [local]);

  async function save() {
    setSaving(true);
    try {
      const next = await superAdminApi.saveTerrainFeatures(terrainId, local.map((f) => ({ cle: f.cle, actif: f.actif })));
      setLocal(next);
      onSaved?.(next);
      toast.success("Fonctionnalités enregistrées");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Enregistrement impossible");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-[13px]" style={{ color: "var(--sa-muted)" }}>
        Activez ou désactivez les fonctionnalités pour ce terrain spécifiquement
      </p>
      {grouped.map((g) => (
        <div key={g.impact} className="rounded-xl p-4 space-y-3" style={{ background: "var(--sa-surface)", boxShadow: "var(--sa-shadow)" }}>
          <span className="inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ color: g.color, background: "var(--sa-surface-2)" }}>{g.label}</span>
          {g.items.map((f) => (
            <label key={f.cle} className="flex items-start gap-3 py-2" style={{ borderTop: "1px solid var(--sa-border)" }}>
              <LucideByName name={f.icone} size={18} className="mt-0.5 shrink-0" style={{ color: "var(--sa-primary)" }} />
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold" style={{ color: "var(--sa-text)" }}>{f.label}</p>
                <p className="text-[12px]" style={{ color: "var(--sa-muted)" }}>{f.description}</p>
              </div>
              <input
                type="checkbox"
                checked={Boolean(f.actif)}
                onChange={(e) => setLocal((prev) => prev.map((x) => (x.cle === f.cle ? { ...x, actif: e.target.checked } : x)))}
                className="mt-1 h-5 w-5"
              />
            </label>
          ))}
        </div>
      ))}
      <button type="button" disabled={saving} onClick={save} className="min-h-[44px] px-4 rounded-lg text-[13px] font-semibold text-white inline-flex items-center gap-2" style={{ background: "var(--sa-primary)" }}>
        {saving ? <Loader2 size={14} className="animate-spin" /> : null}
        Enregistrer les fonctionnalités
      </button>
      <p className="text-[11px]" style={{ color: "var(--sa-muted)" }}>
        Ces paramètres s&apos;appliquent uniquement à ce terrain. Les autres terrains ne sont pas affectés.
      </p>
    </div>
  );
}
