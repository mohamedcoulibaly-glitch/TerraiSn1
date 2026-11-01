import { Link } from "react-router-dom";
import { QrCode, ArrowRight } from "lucide-react";

/**
 * Ancien « scanner libre » (CDC v2.1) : le scan se fait depuis la file du jour
 * ou la fiche réservation. On garde la route pour les deep-links / formation.
 */
export default function ScannerGerant() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="max-w-md w-full text-center space-y-4">
        <div className="mx-auto w-14 h-14 rounded-full bg-[var(--g-surface-2)] flex items-center justify-center">
          <QrCode className="w-7 h-7 text-[var(--g-primary)]" aria-hidden />
        </div>
        <h1 className="text-xl font-semibold" style={{ fontFamily: "var(--font-display)" }}>
          Scanner une réservation
        </h1>
        <p className="text-sm text-[var(--g-muted)]">
          Ouvre une réservation confirmée dans la file du jour, puis lance le scan QR
          ou saisis le code TF. Le scanner n&apos;est plus une page séparée.
        </p>
        <div className="flex flex-col gap-2 pt-2">
          <Link
            to="/backoffice/gerant#scanner"
            className="inline-flex items-center justify-center gap-2 min-h-[48px] rounded-[12px] bg-[var(--g-primary)] text-white text-sm font-semibold px-4"
          >
            Aller à la file du jour
            <ArrowRight className="w-4 h-4" />
          </Link>
          <Link
            to="/backoffice/gerant"
            className="inline-flex items-center justify-center min-h-[44px] text-sm font-medium text-[var(--g-muted)]"
          >
            Retour accueil gérant
          </Link>
        </div>
      </div>
    </div>
  );
}
