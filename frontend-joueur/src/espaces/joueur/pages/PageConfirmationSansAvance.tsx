import { useNavigate } from "react-router-dom";
import { CheckCircle } from "lucide-react";

type PageConfirmationSansAvanceProps = {
  reservation: {
    terrain_nom?: string;
    date?: string;
    heure_debut?: string;
    heure_fin?: string;
    prix_total?: number;
    montant?: number;
    montant_restant?: number;
    reste_a_payer?: number;
  };
};

/**
 * Page de confirmation dédiée au mode SANS AVANCE.
 * Aucune mention de paiement en ligne, aucun polling PayTech :
 * la réservation est confirmée dès la création, le QR arrive par WhatsApp
 * (envoyé par le gérant du terrain) et le montant total se règle sur place.
 */
export const PageConfirmationSansAvance = ({ reservation }: PageConfirmationSansAvanceProps) => {
  const navigate = useNavigate();
  const total = Number(
    reservation.prix_total ||
      reservation.montant ||
      reservation.montant_restant ||
      reservation.reste_a_payer ||
      0,
  );

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-5 page-enter bg-[var(--background)]">
      <div
        className="w-20 h-20 rounded-full flex items-center justify-center mb-6"
        style={{ background: "var(--color-primary-glow)" }}
      >
        <CheckCircle className="w-10 h-10" style={{ color: "var(--color-primary)" }} />
      </div>

      <h1
        className="text-2xl font-bold text-center mb-2"
        style={{ fontFamily: "var(--font-display)", color: "var(--color-text-primary)" }}
      >
        C'est réservé ! ⚽
      </h1>

      <p className="text-center text-sm mb-6" style={{ color: "var(--color-text-muted)" }}>
        Tu recevras ton QR code par WhatsApp dans quelques secondes.
        Présente-le au gérant le jour du match.
      </p>

      <div
        className="w-full max-w-md rounded-2xl p-4 mb-6 space-y-2"
        style={{ background: "var(--surface)", border: "1px solid var(--color-border)" }}
      >
        <p className="font-semibold text-sm" style={{ color: "var(--color-text-primary)" }}>
          {reservation.terrain_nom}
        </p>
        <p className="text-[13px]" style={{ color: "var(--color-text-muted)" }}>
          {reservation.date} · {reservation.heure_debut} – {reservation.heure_fin}
        </p>
        <p className="text-sm font-semibold pt-1" style={{ color: "var(--color-text-primary)" }}>
          💵 À régler sur place : {total.toLocaleString("fr-SN")} FCFA
        </p>
      </div>

      <button
        type="button"
        onClick={() => navigate("/reservations")}
        className="w-full max-w-md py-3 rounded-xl font-semibold text-sm text-white btn-press"
        style={{ background: "var(--color-primary)" }}
      >
        Voir mes réservations
      </button>
    </div>
  );
};

export default PageConfirmationSansAvance;
