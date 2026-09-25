import { useEffect, useState } from "react";
import {
  COMMODITE_GROUPS,
  COMMODITES_CATALOG,
  catalogFromApiRows,
  type CommoditeDef,
  type CommoditeId,
} from "@/lib/commodites";
import { LucideByName } from "@/lib/lucideByName";
import { getCommoditeIconName } from "@/constants/commoditesIcons";
import { terrainsApi } from "@/lib/api";

type Props = {
  value: CommoditeId[];
  onChange: (next: CommoditeId[]) => void;
  className?: string;
};

/** Sélecteur multi — catalogue DB public, fallback catalogue TS. */
export default function CommoditesPicker({ value, onChange, className = "" }: Props) {
  const [catalog, setCatalog] = useState<CommoditeDef[]>(COMMODITES_CATALOG);

  useEffect(() => {
    let cancelled = false;
    terrainsApi
      .commoditesCatalog()
      .then((rows) => {
        if (cancelled) return;
        const mapped = catalogFromApiRows(Array.isArray(rows) ? rows : []);
        if (mapped.length) setCatalog(mapped);
      })
      .catch(() => {
        /* garde le fallback */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = (id: CommoditeId) => {
    if (value.includes(id)) onChange(value.filter((x) => x !== id));
    else onChange([...value, id]);
  };

  const grouped = COMMODITE_GROUPS.map((group) => ({
    ...group,
    items: catalog.filter((c) => (c.group || "autre") === group.id),
  })).filter((g) => g.items.length > 0);

  const ungrouped = catalog.filter((c) => !COMMODITE_GROUPS.some((g) => g.id === (c.group || "autre")));
  const sections =
    grouped.length > 0
      ? grouped
      : [{ id: "autre" as const, label: "Commodités", items: catalog.length ? catalog : COMMODITES_CATALOG }];

  if (ungrouped.length && grouped.length) {
    sections.push({ id: "autre", label: "Autres", items: ungrouped });
  }

  return (
    <div className={`space-y-4 ${className}`}>
      {sections.map((group) => (
        <div key={group.id}>
          <p className="text-xs font-semibold text-[var(--color-text-muted)] mb-2 uppercase tracking-wide">
            {group.label}
          </p>
          <div className="flex flex-wrap gap-2">
            {group.items.map((c) => {
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
                  <LucideByName
                    name={getCommoditeIconName(c.id, c.icon)}
                    className="w-3.5 h-3.5"
                  />
                  {c.label}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
