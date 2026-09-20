const MAP: Record<string, { label: string; color: string; bg: string }> = {
  en_fenetre: { label: "En fenêtre", color: "var(--sa-warning)", bg: "var(--sa-warning-bg)" },
  payable: { label: "Payable", color: "var(--sa-info)", bg: "var(--sa-info-bg)" },
  verse: { label: "Versé ✓", color: "var(--sa-success)", bg: "var(--sa-success-bg)" },
  echec: { label: "Échoué", color: "var(--sa-danger)", bg: "var(--sa-danger-bg)" },
  annule_rembourse: { label: "Remboursé", color: "var(--sa-muted)", bg: "var(--sa-surface-2)" },
  demande_retrait: { label: "Demande retrait", color: "var(--sa-info)", bg: "var(--sa-info-bg)" },
  en_cours: { label: "En attente", color: "var(--sa-warning)", bg: "var(--sa-warning-bg)" },
  en_attente: { label: "En attente", color: "var(--sa-warning)", bg: "var(--sa-warning-bg)" },
  envoye: { label: "Traité", color: "var(--sa-success)", bg: "var(--sa-success-bg)" },
  annule: { label: "Annulé", color: "var(--sa-muted)", bg: "var(--sa-surface-2)" },
};

type Props = {
  statut: string;
  motif?: string | null;
};

export default function StatutDu({ statut, motif }: Props) {
  const m = MAP[statut] || { label: statut || "—", color: "var(--sa-muted)", bg: "var(--sa-surface-2)" };
  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <span
        className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold"
        style={{ background: m.bg, color: m.color }}
      >
        {m.label}
      </span>
      {motif ? (
        <span className="text-[10px] max-w-[180px]" style={{ color: "var(--sa-danger)" }} title={motif}>
          {motif}
        </span>
      ) : null}
    </span>
  );
}
