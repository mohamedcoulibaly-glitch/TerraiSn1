import { COMMODITE_GROUPS, COMMODITES_CATALOG, type CommoditeId } from "@/lib/commodites";
import { LucideByName } from "@/lib/lucideByName";
import { getCommoditeIconName } from "@/constants/commoditesIcons";

type Props = {
  value: CommoditeId[];
  onChange: (next: CommoditeId[]) => void;
  className?: string;
};

/** Sélecteur multi pour création / édition terrain */
export default function CommoditesPicker({ value, onChange, className = "" }: Props) {
  const toggle = (id: CommoditeId) => {
    if (value.includes(id)) onChange(value.filter((x) => x !== id));
    else onChange([...value, id]);
  };

  return (
    <div className={`space-y-4 ${className}`}>
      {COMMODITE_GROUPS.map((group) => {
        const items = COMMODITES_CATALOG.filter((c) => c.group === group.id);
        return (
          <div key={group.id}>
            <p className="text-xs font-semibold text-[var(--color-text-muted)] mb-2 uppercase tracking-wide">
              {group.label}
            </p>
            <div className="flex flex-wrap gap-2">
              {items.map((c) => {
                const active = value.includes(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => toggle(c.id)}
                    className={`inline-flex items-center gap-1.5 px-3 min-h-[36px] rounded-full text-sm font-medium border transition-colors ${
                      active
                        ? "bg-[var(--color-primary)] text-white border-[var(--color-primary)]"
                        : "bg-[var(--surface)] text-[var(--color-text-secondary)] border-[var(--color-border)]"
                    }`}
                  >
                    <LucideByName name={getCommoditeIconName(c.id, c.icon)} className="w-3.5 h-3.5" />
                    {c.label}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
