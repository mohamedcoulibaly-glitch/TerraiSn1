type BottomBarSansAvanceProps = {
  /** "Aujourd'hui · 18h00 → 19h00 · 1 heure" */
  creneauLabel: string;
  formatLabel?: string;
  onReserver: () => void;
};

/**
 * CTA réservation dédié aux terrains SANS AVANCE.
 * Ne mentionne jamais le paiement en ligne : la réservation est confirmée
 * directement, le règlement se fait sur place le jour du match.
 * Composant autonome — aucun code partagé avec BottomBarAvecAvance.
 */
export const BottomBarSansAvance = ({ creneauLabel, formatLabel, onReserver }: BottomBarSansAvanceProps) => {
  return (
    <div className="mt-4 rounded-2xl border border-[var(--color-border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-sm)] scroll-mt-24 space-y-3">
      <div>
        <p className="text-sm font-semibold text-[var(--color-text-primary)]">{creneauLabel}</p>
        {formatLabel ? (
          <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">{formatLabel}</p>
        ) : null}
      </div>
      <p className="text-[13px] leading-snug text-[var(--color-text-secondary)]">
        Règlement sur place le jour du match — rien à payer en ligne.
      </p>
      <button
        type="button"
        onClick={onReserver}
        className="w-full min-h-[52px] rounded-xl bg-[var(--primary)] text-white text-sm font-semibold btn-press"
      >
        Réserver
      </button>
    </div>
  );
};

export default BottomBarSansAvance;
