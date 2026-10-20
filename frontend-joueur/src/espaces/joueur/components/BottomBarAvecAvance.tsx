type BottomBarAvecAvanceProps = {
  /** "Aujourd'hui · 18h00 → 19h00 · 1 heure" */
  creneauLabel: string;
  formatLabel?: string;
  /** Note complète : total, avance maintenant, reste sur place */
  paiementNote: string;
  /** Montant d'avance formaté, ex "5 000" */
  avanceLabel: string;
  onPayer: () => void;
};

/**
 * CTA réservation dédié aux terrains AVEC AVANCE.
 * Affiche l'avance à payer maintenant et le reste sur place, puis envoie
 * vers le paiement. Composant autonome — aucun code partagé avec
 * BottomBarSansAvance.
 */
export const BottomBarAvecAvance = ({
  creneauLabel,
  formatLabel,
  paiementNote,
  avanceLabel,
  onPayer,
}: BottomBarAvecAvanceProps) => {
  return (
    <div className="mt-4 rounded-2xl border border-[var(--color-border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-sm)] scroll-mt-24 space-y-3">
      <div>
        <p className="text-sm font-semibold text-[var(--color-text-primary)]">{creneauLabel}</p>
        {formatLabel ? (
          <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">{formatLabel}</p>
        ) : null}
      </div>
      <p className="text-[13px] leading-snug text-[var(--color-text-secondary)]">{paiementNote}</p>
      <button
        type="button"
        onClick={onPayer}
        className="w-full min-h-[52px] rounded-xl bg-[var(--primary)] text-white text-sm font-semibold btn-press"
      >
        {`Réserver · payer ${avanceLabel} FCFA`}
      </button>
      <p className="text-[11px] text-center text-[var(--color-text-muted)]">
        Avance maintenant · Reste sur place
      </p>
    </div>
  );
};

export default BottomBarAvecAvance;
