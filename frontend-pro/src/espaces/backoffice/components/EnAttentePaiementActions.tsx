import { useState } from "react";
import { Ban, CheckCircle2, Loader2, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { gerantApi, reservationsApi } from "@/lib/api";
import { ConfirmationModal } from "@/espaces/backoffice/components/ConfirmationModal";
import { useWhatsappInfra } from "@/hooks/useWhatsappInfra";
import { confirmWhatsappAction, WHATSAPP_INFRA_MESSAGE } from "@/lib/whatsappMessages";
import { featureEnabled } from "@/lib/terrainFeatures";

type Props = {
  reservationId: number;
  montantAvance?: number;
  features?: Record<string, boolean> | null;
  /** compact = boutons plus petits (listes / dashboard) */
  variant?: "full" | "compact";
  onDone?: () => void;
};

function formatFcfa(value?: number) {
  return `${Number(value || 0).toLocaleString("fr-FR")} FCFA`;
}

/**
 * Actions post-envoi du lien de paiement (statut en_attente) :
 * 1. Renvoyer le lien
 * 2. Confirmer manuellement (dette commission) — confirmation 2 temps
 * 3. Annuler — confirmation 2 temps
 */
export default function EnAttentePaiementActions({
  reservationId,
  montantAvance,
  features,
  variant = "full",
  onDone,
}: Props) {
  const { down: waDown } = useWhatsappInfra(true);
  const [resending, setResending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [confirmManualOpen, setConfirmManualOpen] = useState(false);
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);

  const canConfirmManual = featureEnabled(features, "confirmations_manuelles", true);
  const busy = resending || confirming || cancelling;
  const compact = variant === "compact";
  const btnBase = compact
    ? "w-full min-h-[44px] px-3 rounded-xl text-xs font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-60"
    : "w-full min-h-[52px] px-4 rounded-xl text-sm font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-60";

  const handleResend = async () => {
    if (waDown) {
      toast.error(WHATSAPP_INFRA_MESSAGE);
      if (!confirmWhatsappAction(true)) return;
    }
    setResending(true);
    try {
      await reservationsApi.renvoyerLienWhatsApp(reservationId);
      toast.success("Lien de paiement renvoyé par WhatsApp");
      onDone?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : WHATSAPP_INFRA_MESSAGE);
    } finally {
      setResending(false);
    }
  };

  const handleConfirmManual = async () => {
    setConfirming(true);
    try {
      await gerantApi.confirmerManuellement(
        reservationId,
        "Avance reçue hors PayTech (confirmation manuelle)",
      );
      toast.success("Réservation confirmée — commission mise en dette");
      setConfirmManualOpen(false);
      onDone?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Confirmation manuelle impossible");
    } finally {
      setConfirming(false);
    }
  };

  const handleAnnuler = async () => {
    setCancelling(true);
    try {
      await reservationsApi.annulerGerant(reservationId);
      toast.success("Réservation annulée — créneau libéré");
      setConfirmCancelOpen(false);
      onDone?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Annulation impossible");
    } finally {
      setCancelling(false);
    }
  };

  return (
    <>
      <section
        className={compact ? "space-y-2" : "rounded-2xl p-4 space-y-3"}
        style={
          compact
            ? undefined
            : {
                background: "var(--g-surface, #fff)",
                border: "1px solid var(--g-border, var(--color-border))",
                boxShadow: "var(--g-shadow)",
              }
        }
      >
        {!compact ? (
          <div>
            <h3 className="text-sm font-semibold" style={{ color: "var(--g-text, var(--color-text-primary))" }}>
              Paiement en attente
            </h3>
            <p className="text-xs mt-1" style={{ color: "var(--g-muted, var(--color-text-muted))" }}>
              Le lien a été envoyé. Tu peux le renvoyer, confirmer l&apos;avance reçue, ou annuler.
            </p>
          </div>
        ) : null}

        <button
          type="button"
          onClick={() => void handleResend()}
          disabled={busy}
          className={`${btnBase} text-white`}
          style={{ background: "#25D366" }}
        >
          {resending ? <Loader2 className={compact ? "w-4 h-4 animate-spin" : "w-5 h-5 animate-spin"} /> : <MessageCircle className={compact ? "w-4 h-4" : "w-5 h-5"} />}
          {resending ? "Envoi…" : "Renvoyer le lien de paiement"}
        </button>

        {canConfirmManual ? (
          <button
            type="button"
            onClick={() => setConfirmManualOpen(true)}
            disabled={busy}
            className={`${btnBase} text-white`}
            style={{ background: "var(--g-warning, #d97706)" }}
          >
            {confirming ? <Loader2 className={compact ? "w-4 h-4 animate-spin" : "w-5 h-5 animate-spin"} /> : <CheckCircle2 className={compact ? "w-4 h-4" : "w-5 h-5"} />}
            {confirming ? "Confirmation…" : "Confirmer manuellement"}
          </button>
        ) : null}

        <button
          type="button"
          onClick={() => setConfirmCancelOpen(true)}
          disabled={busy}
          className={btnBase}
          style={{
            border: "1.5px solid var(--g-danger, var(--color-danger))",
            color: "var(--g-danger, var(--color-danger))",
            background: "transparent",
          }}
        >
          {cancelling ? <Loader2 className={compact ? "w-4 h-4 animate-spin" : "w-5 h-5 animate-spin"} /> : <Ban className={compact ? "w-4 h-4" : "w-5 h-5"} />}
          {cancelling ? "Annulation…" : "Annuler la réservation"}
        </button>

        {!compact && canConfirmManual ? (
          <p className="text-[11px] text-center" style={{ color: "var(--g-muted, var(--color-text-muted))" }}>
            Confirmation manuelle = avance déjà reçue hors PayTech. La commission TerrainSN passe en dette.
          </p>
        ) : null}
      </section>

      <ConfirmationModal
        ouvert={confirmManualOpen}
        titre="Confirmer manuellement ?"
        texte={[
          "Tu confirmes que l’avance a déjà été reçue (espèces, Wave, Orange Money…).",
          montantAvance != null ? `Avance attendue : ${formatFcfa(montantAvance)}.` : null,
          "Le créneau sera verrouillé, le joueur recevra son QR, et la commission TerrainSN sera ajoutée à ta dette du mois.",
          "Cette action est définitive.",
        ]
          .filter(Boolean)
          .join("\n\n")}
        labelAnnuler="Retour"
        labelConfirmer={confirming ? "Confirmation…" : "Oui, confirmer (dette commission)"}
        variante="warning"
        onAnnuler={() => {
          if (!confirming) setConfirmManualOpen(false);
        }}
        onConfirmer={() => void handleConfirmManual()}
      />

      <ConfirmationModal
        ouvert={confirmCancelOpen}
        titre="Annuler cette réservation ?"
        texte={[
          "Le joueur n’a pas encore payé (lien en attente).",
          "Le créneau sera libéré immédiatement.",
          "Le joueur pourra être notifié par WhatsApp.",
          "Cette action est définitive.",
        ].join("\n\n")}
        labelAnnuler="Garder"
        labelConfirmer={cancelling ? "Annulation…" : "Oui, annuler — créneau libéré"}
        variante="danger"
        onAnnuler={() => {
          if (!cancelling) setConfirmCancelOpen(false);
        }}
        onConfirmer={() => void handleAnnuler()}
      />
    </>
  );
}
