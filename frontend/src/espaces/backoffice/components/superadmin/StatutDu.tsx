import type { StatutDu as StatutDuType } from "@/lib/saContrat";

const MAP: Record<StatutDuType, { label: string; color: string; bg: string }> = {
  en_fenetre: { label: "En fenêtre", color: "var(--sa-warning)", bg: "var(--sa-warning-bg)" },
  payable: { label: "Payable", color: "var(--sa-info)", bg: "var(--sa-info-bg)" },
  verse: { label: "Versé ✓", color: "var(--sa-success)", bg: "var(--sa-success-bg)" },
  echec: { label: "Échec", color: "var(--sa-danger)", bg: "var(--sa-danger-bg)" },
  annule_rembourse: { label: "Remboursé", color: "var(--sa-muted)", bg: "var(--sa-surface-2)" },
};

type Props = {
  statut: StatutDuType;
};

export default function StatutDu({ statut }: Props) {
  const m = MAP[statut];
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold"
      style={{ background: m.bg, color: m.color }}
    >
      {m.label}
    </span>
  );
}
