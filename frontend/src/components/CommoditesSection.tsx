import { normalizePublicCommodites } from "@/lib/commodites";
import { LucideByName } from "@/lib/lucideByName";
import { getCommoditeIconName } from "@/constants/commoditesIcons";

type Props = {
  commodites?: unknown;
  className?: string;
  compact?: boolean;
};

export default function CommoditesSection({ commodites, className = "", compact = false }: Props) {
  const items = normalizePublicCommodites(commodites);
  if (items.length === 0) return null;

  return (
    <section className={className}>
      <h2
        className={`font-bold text-[var(--color-text-primary)] ${compact ? "text-sm mb-2.5" : "section-title mb-3"}`}
        style={compact ? { fontFamily: "var(--font-display)" } : undefined}
      >
        Équipements
      </h2>
      <div className="flex flex-wrap gap-2">
        {items.map((c) => (
          <span
            key={c.cle}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold"
            style={{
              background: "var(--color-primary-glow, var(--primary-glow))",
              color: "var(--color-primary, var(--primary))",
              border: "1px solid color-mix(in srgb, var(--color-primary, var(--primary)) 22%, transparent)",
            }}
          >
            <LucideByName name={getCommoditeIconName(c.cle, c.icone)} className="w-3.5 h-3.5" />
            {c.label_fr}
          </span>
        ))}
      </div>
    </section>
  );
}
