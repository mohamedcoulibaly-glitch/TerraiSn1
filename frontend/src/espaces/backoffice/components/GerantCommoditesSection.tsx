import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { gerantApi } from "@/lib/api";
import { LucideByName } from "@/lib/lucideByName";
import { getCommoditeIconName } from "@/constants/commoditesIcons";
import CommoditesSection from "@/components/CommoditesSection";

export type GerantCommodite = {
  id: number;
  cle: string;
  label_fr: string;
  icone: string;
  associee?: boolean;
  force_par_admin?: number;
  modifiable_gerant?: number;
};

export default function GerantCommoditesSection() {
  const [items, setItems] = useState<GerantCommodite[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(false);

  useEffect(() => {
    gerantApi.terrainCommodites().then((list: GerantCommodite[]) => {
      const rows = Array.isArray(list) ? list : [];
      setItems(rows);
      setSelected(new Set(rows.filter((c) => c.associee).map((c) => Number(c.id))));
    }).catch(() => toast.error("Impossible de charger les équipements"));
  }, []);

  const previewItems = useMemo(
    () => items.filter((c) => selected.has(Number(c.id))).map((c) => ({ cle: c.cle, label_fr: c.label_fr, icone: c.icone })),
    [items, selected],
  );

  function toggle(c: GerantCommodite) {
    if (Number(c.force_par_admin) === 1 || Number(c.modifiable_gerant) === 0) return;
    setSelected((prev) => {
      const next = new Set(prev);
      const id = Number(c.id);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save() {
    setSaving(true);
    try {
      const list = (await gerantApi.patchTerrainCommodites([...selected])) as GerantCommodite[];
      setItems(list);
      setSelected(new Set(list.filter((c) => c.associee).map((c) => Number(c.id))));
      toast.success("Équipements mis à jour ✓");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Enregistrement impossible");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-xl p-5 space-y-4" style={{ background: "var(--g-surface)", boxShadow: "var(--g-shadow)" }}>
      <div>
        <h2 className="text-sm font-semibold" style={{ color: "var(--g-text)" }}>Équipements disponibles</h2>
        <p className="text-[12px] mt-1" style={{ color: "var(--g-muted)" }}>
          Ces informations s&apos;affichent aux joueurs sur la fiche de ton terrain
        </p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5">
        {items.map((c) => {
          const on = selected.has(Number(c.id));
          const forced = Number(c.force_par_admin) === 1;
          const locked = Number(c.modifiable_gerant) === 0;
          const disabled = forced || locked;
          return (
            <button
              key={c.id}
              type="button"
              disabled={disabled}
              title={forced ? "Défini par l'administration" : locked ? "Non modifiable" : c.label_fr}
              onClick={() => toggle(c)}
              className="relative rounded-xl p-3 min-h-[120px] flex flex-col items-center justify-between gap-2 text-center transition-all duration-200"
              style={{
                background: on ? "var(--g-primary-glow)" : "var(--g-surface-2)",
                border: `1px solid ${on ? "var(--g-primary)" : "var(--g-border)"}`,
                opacity: locked && !forced ? 0.5 : 1,
              }}
            >
              {forced ? (
                <span className="absolute top-1.5 right-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: "var(--g-primary-glow)", color: "var(--g-primary)" }}>
                  Admin
                </span>
              ) : null}
              <LucideByName name={getCommoditeIconName(c.cle, c.icone)} size={22} style={{ color: "var(--g-primary)" }} />
              <span className="text-[13px] font-semibold leading-tight" style={{ color: "var(--g-text)" }}>{c.label_fr}</span>
              <span className="text-[10px] font-bold uppercase" style={{ color: on ? "var(--g-primary)" : "var(--g-muted)" }}>{on ? "ON" : "OFF"}</span>
            </button>
          );
        })}
      </div>
      <button type="button" disabled={saving} onClick={save} className="w-full min-h-[48px] rounded-xl text-sm font-semibold text-white disabled:opacity-60 inline-flex items-center justify-center gap-2" style={{ background: "var(--g-primary)" }}>
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
        Enregistrer
      </button>
      <button type="button" onClick={() => setPreview((v) => !v)} className="w-full text-[12px] font-semibold" style={{ color: "var(--g-primary)" }}>
        {preview ? "Masquer l'aperçu joueur" : "Voir l'aperçu joueur"}
      </button>
      {preview ? <CommoditesSection commodites={previewItems} compact /> : null}
    </section>
  );
}
