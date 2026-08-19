import { useMemo } from "react";
import { Loader2 } from "lucide-react";
import { LucideByName } from "@/lib/lucideByName";
import { getCommoditeIconName } from "@/constants/commoditesIcons";

export type CommoditeToggle = {
  id: number;
  cle: string;
  label_fr: string;
  icone: string;
  associee?: boolean;
  actif?: number;
};

type Props = {
  items: CommoditeToggle[];
  selectedIds: number[];
  onChange: (ids: number[]) => void;
  onSave?: () => void;
  saving?: boolean;
  showSave?: boolean;
  embedded?: boolean;
};

export default function TerrainCommoditesEditor({
  items,
  selectedIds,
  onChange,
  onSave,
  saving,
  showSave = true,
  embedded = false,
}: Props) {
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const preview = items.filter((c) => selected.has(c.id));

  function toggle(id: number) {
    if (selected.has(id)) onChange(selectedIds.filter((x) => x !== id));
    else onChange([...selectedIds, id]);
  }

  const body = (
    <>
      {!embedded ? (
        <>
          <h3 className="text-[15px] font-semibold" style={{ color: "var(--sa-text)" }}>
            Commodités du terrain
          </h3>
          <p className="mt-1 text-[12px]" style={{ color: "var(--sa-muted)" }}>
            Ces équipements s&apos;affichent sur la fiche joueur.
          </p>
        </>
      ) : null}
      <div className={embedded ? "grid grid-cols-2 md:grid-cols-3 gap-2" : "mt-4 grid grid-cols-2 md:grid-cols-3 gap-2"}>
        {items.map((c) => {
          const on = selected.has(c.id);
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => toggle(c.id)}
              className="text-left rounded-xl p-3 flex items-center gap-2 transition-all duration-200"
              style={{
                background: on ? "var(--sa-primary-glow)" : "var(--sa-surface-2)",
                border: on ? "1px solid var(--sa-primary)" : "1px solid var(--sa-border)",
              }}
            >
              <LucideByName name={getCommoditeIconName(c.cle, c.icone)} size={20} style={{ color: "var(--sa-primary)" }} />
              <span className="flex-1 text-[13px] font-medium" style={{ color: "var(--sa-text)" }}>
                {c.label_fr}
              </span>
              <span
                className="sa-switch pointer-events-none scale-75"
                role="switch"
                aria-checked={on}
                aria-hidden
              >
                <span className="sa-switch-thumb" />
              </span>
            </button>
          );
        })}
      </div>
      {showSave && onSave ? (
        <button
          type="button"
          disabled={saving}
          onClick={onSave}
          className="mt-4 min-h-[44px] px-4 rounded-lg text-[13px] font-semibold text-white inline-flex items-center gap-2"
          style={{ background: "var(--sa-primary)", opacity: saving ? 0.7 : 1 }}
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : null}
          Enregistrer les commodités
        </button>
      ) : null}
      <details className="mt-4 rounded-lg p-3" style={{ background: "var(--sa-surface-2)" }}>
        <summary className="text-[12px] font-medium cursor-pointer" style={{ color: "var(--sa-muted)" }}>
          Aperçu — interface joueur
        </summary>
        <div className="mt-3 flex flex-wrap gap-2">
          {preview.length === 0 ? (
            <p className="text-[12px]" style={{ color: "var(--sa-muted)" }}>Aucune commodité sélectionnée.</p>
          ) : (
            preview.map((c) => (
              <span
                key={c.id}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold"
                style={{ background: "var(--sa-primary-glow)", color: "var(--sa-primary)" }}
              >
                <LucideByName name={getCommoditeIconName(c.cle, c.icone)} className="w-3.5 h-3.5" />
                {c.label_fr}
              </span>
            ))
          )}
        </div>
      </details>
    </>
  );

  if (embedded) return body;

  return (
    <section
      className="rounded-xl"
      style={{
        background: "var(--sa-surface)",
        borderRadius: 12,
        padding: 20,
        borderTop: "3px solid var(--sa-info)",
        boxShadow: "var(--sa-shadow)",
      }}
    >
      {body}
    </section>
  );
}
