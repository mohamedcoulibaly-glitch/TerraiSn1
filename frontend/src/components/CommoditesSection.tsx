import { resolveCommodites } from "@/lib/commodites";

type Props = {
  commodites?: unknown;
  className?: string;
  /** Grille plus dense sous le header */
  compact?: boolean;
};

/** Section « Services & Équipements inclus » — fiche détail terrain */
export default function CommoditesSection({ commodites, className = "", compact = false }: Props) {
  const items = resolveCommodites(commodites);
  if (items.length === 0) return null;

  return (
    <section className={className}>
      <h2
        className={`font-bold text-[var(--color-text-primary)] ${compact ? "text-sm mb-2.5" : "section-title mb-3"}`}
        style={compact ? { fontFamily: "var(--font-display)" } : undefined}
      >
        Services &amp; Équipements inclus
      </h2>
      <ul className={`grid gap-2 ${compact ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-2 sm:grid-cols-3"}`}>
        {items.map((c) => (
          <li
            key={c.id}
            className={`flex items-center gap-2 rounded-xl border border-gray-100 dark:border-[var(--border)] bg-[#F9FAFB] dark:bg-[var(--surface-2)] ${
              compact ? "px-2.5 py-2 min-h-[40px]" : "px-3 py-2.5 min-h-[48px]"
            }`}
          >
            <span className={`shrink-0 ${compact ? "text-sm" : "text-base"}`} aria-hidden>
              {c.icon}
            </span>
            <span
              className={`font-medium text-[var(--color-text-secondary)] leading-snug ${
                compact ? "text-[11px]" : "text-[13px]"
              }`}
            >
              {c.label}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
