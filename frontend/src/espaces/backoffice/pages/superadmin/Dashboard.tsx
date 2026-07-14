import { useEffect, useState } from "react";
import { Map, CalendarDays, Banknote, Users } from "lucide-react";
import { superAdminApi } from "@/services/superAdminApi";

export default function Dashboard() {
  const [d, setD] = useState<any>();
  const [comptes, setComptes] = useState<number | null>(null);

  useEffect(() => {
    superAdminApi.dashboard().then(setD).catch(console.error);
    superAdminApi
      .users()
      .then((u: any[]) => setComptes(Array.isArray(u) ? u.length : 0))
      .catch(() => setComptes(0));
  }, []);

  const cards = [
    {
      label: "Revenus globaux (mois)",
      value: `${Number(d?.revenusMois || 0).toLocaleString()}`,
      suffix: "CFA",
      gold: true,
      icon: Banknote,
      tint: "bg-[color-mix(in_srgb,var(--color-accent)_20%,white)] text-[var(--color-accent)]",
    },
    {
      label: "Terrains actifs",
      value: String(d?.terrainsActifs ?? "…"),
      icon: Map,
      tint: "bg-[color-mix(in_srgb,var(--color-primary)_12%,white)] text-[var(--color-primary)]",
    },
    {
      label: "Réservations du jour",
      value: String(d?.reservationsAujourdhui ?? "…"),
      icon: CalendarDays,
      tint: "bg-[color-mix(in_srgb,var(--color-info)_12%,white)] text-[var(--color-info)]",
    },
    {
      label: "Accès métier",
      value: comptes === null ? "…" : String(comptes),
      icon: Users,
      tint: "bg-[color-mix(in_srgb,var(--color-warning)_14%,white)] text-[var(--color-warning)]",
    },
  ];

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h2
          className="text-xl font-semibold text-[var(--color-text-primary)]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Dashboard
        </h2>
        <p className="text-sm text-[var(--color-text-secondary)] mt-1">
          Indicateurs globaux de la plateforme
        </p>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {cards.map((c) => (
          <article
            key={c.label}
            className="bg-white rounded-[var(--radius-md)] border border-[var(--color-border)] p-4 shadow-sm"
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs text-[var(--color-text-secondary)] leading-snug">{c.label}</p>
              <span className={`inline-flex items-center justify-center w-9 h-9 rounded-full ${c.tint}`}>
                <c.icon className="w-4 h-4" />
              </span>
            </div>
            <p
              className={`mt-3 text-[28px] leading-none font-semibold ${
                c.gold ? "text-[var(--color-accent)]" : "text-[var(--color-text-primary)]"
              }`}
              style={{ fontFamily: "var(--font-display)" }}
            >
              {c.value}
              {c.suffix && (
                <span className="text-sm font-medium text-[var(--color-text-muted)] ml-1">
                  {c.suffix}
                </span>
              )}
            </p>
          </article>
        ))}
      </div>
    </div>
  );
}
