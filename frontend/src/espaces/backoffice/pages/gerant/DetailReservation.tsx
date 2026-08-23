import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Link2, MessageCircle, Phone } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { gerantApi, reservationsApi } from "@/lib/api";
import ScannerModal from "@/espaces/backoffice/components/ScannerModal";
import ValidationManuelleModal from "@/espaces/backoffice/components/ValidationManuelleModal";
import LierJoueurModal from "@/espaces/backoffice/modules/crm/ui/LierJoueurModal";
import { toast } from "sonner";
import { estDansLaFenetreCheckIn, calculerFenetreCheckIn } from "@/lib/checkInFenetre";
import { ConfirmationModal } from "@/espaces/backoffice/components/ConfirmationModal";
import { useWhatsappInfra } from "@/hooks/useWhatsappInfra";
import { confirmWhatsappAction, WHATSAPP_INFRA_MESSAGE } from "@/lib/whatsappMessages";
import { featureEnabled } from "@/lib/terrainFeatures";

type PolitiqueRemboursement = {
  eligible?: boolean;
  delai_heures?: number;
  message?: string;
  titre?: string;
  type_annulation?: "avec_remboursement" | "sans_remboursement" | string;
  raison?: string;
};

type GerantReservation = {
  id: number;
  code_reservation?: string | null;
  joueur_id?: number | null;
  joueur_nom?: string | null;
  joueur_telephone?: string | null;
  date: string;
  heure_debut: string;
  heure_fin: string;
  statut: string;
  montant_total?: number;
  montant_avance?: number;
  montant_restant?: number;
  qr_code_scanne_at?: string | null;
  qr_code_payload?: string | null;
  terrain_nom?: string | null;
  type_reservation?: string;
  fenetre_retard?: number | null;
  fenetre_debut?: string | null;
  fenetre_fin?: string | null;
  dans_fenetre_checkin?: boolean;
  scannable_now?: boolean;
  scan_bloque_par_priorite?: boolean;
  priorite_scan_id?: number | null;
  priorite_heure?: string | null;
  priorite_joueur?: string | null;
  operational_stage?: string;
  politique_remboursement?: PolitiqueRemboursement;
};

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  confirme: {
    label: "Réservé ✓",
    className: "bg-[color-mix(in_srgb,var(--color-success)_14%,white)] text-[var(--color-success)]",
  },
  match_joue: {
    label: "Terminé ✓",
    className: "bg-[var(--color-primary)] text-white",
  },
  joue: {
    label: "Terminé ✓",
    className: "bg-[var(--color-primary)] text-white",
  },
  en_attente: {
    label: "Paiement en cours",
    className: "bg-[var(--g-en-attente-bg)] text-[var(--g-en-attente)]",
  },
  acceptee: {
    label: "Réservé ✓",
    className: "bg-[color-mix(in_srgb,var(--color-success)_14%,white)] text-[var(--color-success)]",
  },
  annule: {
    label: "Annulée",
    className: "bg-[var(--color-surface-2)] text-[var(--color-text-muted)]",
  },
  annulee: {
    label: "Annulée",
    className: "bg-[var(--color-surface-2)] text-[var(--color-text-muted)]",
  },
};

function formatLongDate(value?: string) {
  if (!value) return "-";
  return new Date(`${value}T00:00:00`).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatEntreeValidee(value?: string | null) {
  if (!value) return "✅ Entrée validée";
  const raw = String(value).trim();
  const date = new Date(raw.includes("T") ? raw : raw.replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return "✅ Entrée validée";
  const jour = date.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const heure = date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  return `✅ Entrée validée le ${jour} à ${heure}`;
}

function formatFcfa(value?: number) {
  return `${Number(value || 0).toLocaleString("fr-FR")} FCFA`;
}

function DetailSkeleton() {
  return (
    <div className="max-w-xl mx-auto space-y-4 animate-pulse">
      <div className="h-8 w-40 rounded bg-[var(--color-surface-2)]" />
      <div className="h-28 rounded-[var(--radius-md)] bg-[var(--color-surface-2)]" />
      <div className="h-36 rounded-[var(--radius-md)] bg-[var(--color-surface-2)]" />
      <div className="h-28 rounded-[var(--radius-md)] bg-[var(--color-surface-2)]" />
      <div className="h-14 rounded-[var(--radius-md)] bg-[var(--color-surface-2)]" />
    </div>
  );
}

export default function DetailReservation() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [reservation, setReservation] = useState<GerantReservation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [lierOpen, setLierOpen] = useState(false);
  const [resending, setResending] = useState(false);
  const [sendingQr, setSendingQr] = useState(false);
  const [encaissing, setEncaissing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmEncaisser, setConfirmEncaisser] = useState(false);
  const [confirmManualOpen, setConfirmManualOpen] = useState(false);
  const [confirmingManual, setConfirmingManual] = useState(false);
  const [methode, setMethode] = useState<"especes" | "wave" | "orange_money">("especes");
  const [features, setFeatures] = useState<Record<string, boolean> | null>(null);
  const { down: waDown } = useWhatsappInfra(true);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError("");
    try {
      const data = (await gerantApi.reservationDetail(id)) as GerantReservation;
      setReservation(data);
    } catch (err) {
      setReservation(null);
      setError(err instanceof Error ? err.message : "Réservation introuvable");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    let mounted = true;
    gerantApi
      .dashboard()
      .then((dash) => {
        if (!mounted) return;
        const f = (dash as { features?: Record<string, boolean> })?.features;
        setFeatures(f && typeof f === "object" ? f : {});
      })
      .catch(() => {
        if (mounted) setFeatures({});
      });
    return () => {
      mounted = false;
    };
  }, []);

  if (loading) return <DetailSkeleton />;

  if (error || !reservation) {
    return (
      <div className="max-w-xl mx-auto space-y-4">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-2 text-sm text-[var(--color-text-secondary)] min-h-[44px]"
        >
          <ArrowLeft className="w-4 h-4" /> Retour
        </button>
        <p className="text-sm text-[var(--color-danger)]">{error || "Réservation introuvable"}</p>
      </div>
    );
  }

  const badge = STATUS_BADGE[reservation.statut] || {
    label: reservation.statut,
    className: "bg-[var(--color-surface-2)] text-[var(--color-text-muted)]",
  };
  const dejaScanne = Boolean(reservation.qr_code_scanne_at);
  const hideScanner = dejaScanne || ["match_joue", "joue"].includes(reservation.statut);
  const reste = Number(reservation.montant_restant || 0);

  const dansFenetre = estDansLaFenetreCheckIn({
    date: reservation.date,
    heure_debut: reservation.heure_debut,
    heure_fin: reservation.heure_fin,
    fenetre_retard: reservation.fenetre_retard,
  });

  const { heureDebutMs, heureFinMs, retardMin } = calculerFenetreCheckIn({
    date: reservation.date,
    heure_debut: reservation.heure_debut,
    heure_fin: reservation.heure_fin,
    fenetre_retard: reservation.fenetre_retard,
  });
  const nowMs = Date.now();
  const enRetardLive =
    !dejaScanne &&
    ["confirme", "acceptee"].includes(reservation.statut) &&
    nowMs >= heureDebutMs &&
    nowMs <= heureFinMs + retardMin * 60 * 1000;
  const badgeAffiche = enRetardLive
    ? {
        label: "En retard ⏰",
        className: "bg-[color-mix(in_srgb,var(--color-warning)_14%,white)] text-[var(--color-warning)]",
      }
    : badge;

  const canValidateEntree =
    ["confirme", "acceptee"].includes(reservation.statut) &&
    !reservation.qr_code_scanne_at &&
    dansFenetre;
  const canScan =
    canValidateEntree &&
    (typeof reservation.scannable_now === "boolean" ? reservation.scannable_now : true);
  const bloqueParPriorite = canValidateEntree && !canScan;
  const canResendPaymentLink = reservation.statut === "en_attente";
  const canConfirmManual =
    reservation.statut === "en_attente" &&
    featureEnabled(features, "confirmations_manuelles", true);
  const canResendQr =
    Boolean(reservation.code_reservation) &&
    ["confirme", "acceptee"].includes(reservation.statut) &&
    !hideScanner;
  const horsFenetreConfirmée =
    ["confirme", "acceptee"].includes(reservation.statut) && !reservation.qr_code_scanne_at && !dansFenetre;
  const canEncaisser =
    reste > 0 &&
    ["confirme", "acceptee", "match_joue", "joue"].includes(reservation.statut) &&
    (dejaScanne || dansFenetre);
  const canAnnuler = ["en_attente", "confirme", "acceptee"].includes(reservation.statut);

  const fenetreLabel = (() => {
    const debut = reservation.fenetre_debut ? new Date(reservation.fenetre_debut) : null;
    const fin = reservation.fenetre_fin ? new Date(reservation.fenetre_fin) : null;
    const fmt = (d: Date) =>
      d.toLocaleString("fr-FR", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    if (debut && fin && !Number.isNaN(debut.getTime()) && !Number.isNaN(fin.getTime())) {
      return `${fmt(debut)} → ${fmt(fin)}`;
    }
    return "1h avant le début → 2h après la fin (+ tolérance retard)";
  })();

  const handleResendPaymentLink = async () => {
    if (waDown) {
      toast.error(WHATSAPP_INFRA_MESSAGE);
      if (!confirmWhatsappAction(true)) return;
    }
    setResending(true);
    try {
      await reservationsApi.renvoyerLienWhatsApp(reservation.id);
      toast.success("Lien de paiement renvoyé par WhatsApp");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : WHATSAPP_INFRA_MESSAGE);
    } finally {
      setResending(false);
    }
  };

  const handleConfirmManual = async () => {
    if (!reservation) return;
    setConfirmingManual(true);
    try {
      await gerantApi.confirmerManuellement(
        reservation.id,
        "Avance reçue hors PayTech (confirmation manuelle depuis la fiche)",
      );
      toast.success("Réservation confirmée — le joueur va recevoir le QR");
      setConfirmManualOpen(false);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Confirmation manuelle impossible");
    } finally {
      setConfirmingManual(false);
    }
  };

  const handleResendQr = async () => {
    if (waDown) {
      toast.error(WHATSAPP_INFRA_MESSAGE);
      return;
    }
    setSendingQr(true);
    try {
      await reservationsApi.renvoyerConfirmationWhatsApp(reservation.id);
      toast.success("Confirmation + QR envoyés au joueur sur WhatsApp");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : WHATSAPP_INFRA_MESSAGE);
    } finally {
      setSendingQr(false);
    }
  };

  const handleEncaisser = async () => {
    setEncaissing(true);
    try {
      await gerantApi.encaisserRestant(reservation.id, methode);
      toast.success(`Reste encaissé (${methode.replace("_", " ")})`);
      setConfirmEncaisser(false);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Encaissement impossible");
    } finally {
      setEncaissing(false);
    }
  };

  const handleAnnuler = async () => {
    if (!reservation) return;
    setCancelling(true);
    try {
      const result = (await reservationsApi.annulerGerant(reservation.id)) as {
        rembourse?: boolean;
        politique?: PolitiqueRemboursement;
      };
      toast.success(
        result?.rembourse || result?.politique?.type_annulation === "avec_remboursement"
          ? "Réservation annulée — remboursement lancé (WhatsApp envoyé)"
          : "Réservation annulée sans remboursement — créneau libéré (WhatsApp envoyé)",
      );
      setConfirmCancel(false);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Annulation impossible");
    } finally {
      setCancelling(false);
    }
  };

  const openCancelConfirm = async () => {
    setConfirmCancel(true);
    if (!reservation) return;
    try {
      const data = (await reservationsApi.politiqueAnnulation(reservation.id)) as {
        politique_remboursement?: PolitiqueRemboursement;
      };
      if (data?.politique_remboursement) {
        setReservation((prev) =>
          prev ? { ...prev, politique_remboursement: data.politique_remboursement } : prev,
        );
      }
    } catch {
      /* garde la politique déjà chargée */
    }
  };

  return (
    <div className="max-w-xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-2 text-sm text-[var(--color-text-secondary)] min-h-[44px]"
        >
          <ArrowLeft className="w-4 h-4" /> Retour
        </button>
        <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${badgeAffiche.className}`}>
          {badgeAffiche.label}
        </span>
      </div>

      <section className="bg-[color-mix(in_srgb,var(--color-primary)_10%,white)] rounded-[var(--radius-md)] border border-[var(--color-primary)] p-5 text-center space-y-3">
        <p className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
          Code à vérifier (même que sur le WhatsApp / app joueur)
        </p>
        <h1
          className="text-3xl font-bold text-[var(--color-primary)] tracking-wide"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {reservation.code_reservation || `Réservation #${reservation.id}`}
        </h1>
      </section>

      <section className="bg-white rounded-[var(--radius-md)] border border-[var(--color-border)] p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Joueur</h2>
          {!reservation.joueur_id && reservation.statut !== "annule" ? (
            <button
              type="button"
              onClick={() => setLierOpen(true)}
              className="min-h-[36px] px-3 rounded-lg text-xs font-semibold text-[var(--color-primary)] border border-[var(--color-primary)] inline-flex items-center gap-1"
            >
              <Link2 className="w-3.5 h-3.5" /> Lier au CRM / app
            </button>
          ) : null}
        </div>
        <p className="text-base font-medium" style={{ fontFamily: "var(--font-display)" }}>
          {reservation.joueur_nom || "Joueur inconnu"}
        </p>
        {reservation.joueur_id ? (
          <p className="text-xs text-[var(--color-success)]">Lié au compte joueur #{reservation.joueur_id} (visible dans Mes réservations)</p>
        ) : (
          <p className="text-xs text-[var(--color-warning)]">
            Non lié à un compte app — le joueur ne verra pas cette réservation dans Mes réservations.
          </p>
        )}
        {reservation.joueur_telephone ? (
          <a
            href={`tel:${reservation.joueur_telephone}`}
            className="inline-flex items-center gap-2 text-sm text-[var(--color-primary)] min-h-[44px]"
          >
            <Phone className="w-4 h-4" />
            {reservation.joueur_telephone}
          </a>
        ) : (
          <p className="text-sm text-[var(--color-text-muted)]">Téléphone non renseigné</p>
        )}
      </section>

      <section className="bg-white rounded-[var(--radius-md)] border border-[var(--color-border)] p-4 space-y-2">
        <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Match</h2>
        <p className="text-sm text-[var(--color-text-secondary)]">{reservation.terrain_nom || "Terrain"}</p>
        <p className="text-base font-medium capitalize">{formatLongDate(reservation.date)}</p>
        <p className="text-sm text-[var(--color-text-secondary)]">
          {String(reservation.heure_debut).slice(0, 5)} – {String(reservation.heure_fin).slice(0, 5)}
        </p>
      </section>

      <section className="bg-white rounded-[var(--radius-md)] border border-[var(--color-border)] p-4 space-y-3">
        <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Paiement</h2>
        <div className="flex items-center justify-between text-sm">
          <span className="text-[var(--color-text-secondary)]">Avance reçue</span>
          <span className="font-semibold">{formatFcfa(reservation.montant_avance)}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-[var(--color-text-secondary)]">Reste à encaisser sur place</span>
          <span className="font-semibold">{formatFcfa(reste)}</span>
        </div>
        <div className="flex items-center justify-between text-sm pt-1 border-t border-[var(--color-border)]">
          <span className="text-[var(--color-text-secondary)]">Total</span>
          <span className="font-semibold">{formatFcfa(reservation.montant_total)}</span>
        </div>

        {canEncaisser ? (
          <div className="pt-2 space-y-2 border-t border-[var(--color-border)]">
            <p className="text-xs text-[var(--color-text-muted)]">Méthode d&apos;encaissement</p>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  ["especes", "Espèces"],
                  ["wave", "Wave"],
                  ["orange_money", "OM"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setMethode(value)}
                  className={`min-h-[40px] rounded-lg text-xs font-semibold border ${
                    methode === value
                      ? "border-[var(--color-primary)] bg-[var(--color-primary)] text-white"
                      : "border-[var(--color-border)]"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              type="button"
              disabled={encaissing}
              onClick={() => setConfirmEncaisser(true)}
              className="w-full min-h-[48px] rounded-[var(--radius-md)] bg-[var(--color-primary)] text-white text-sm font-medium disabled:opacity-60"
            >
              {encaissing ? "Encaissement…" : `Encaisser ${formatFcfa(reste)}`}
            </button>
          </div>
        ) : null}
      </section>

      {dejaScanne ? (
        <section className="space-y-2">
          <span
            className="inline-flex text-sm font-semibold px-3 py-1.5 rounded-full"
            style={{ background: "var(--g-libre-bg)", color: "var(--g-libre)" }}
          >
            {formatEntreeValidee(reservation.qr_code_scanne_at)}
          </span>
          {reste > 0 ? (
            <span
              className="flex text-sm font-semibold px-3 py-1.5 rounded-full w-fit"
              style={{ background: "var(--g-en-cours-bg)", color: "var(--g-warning)" }}
            >
              💵 Encaisser {reste.toLocaleString("fr-FR")} FCFA sur place
            </span>
          ) : (
            <span
              className="flex text-sm font-semibold px-3 py-1.5 rounded-full w-fit"
              style={{ background: "var(--g-libre-bg)", color: "var(--g-libre)" }}
            >
              ✓ Aucun paiement sur place
            </span>
          )}
        </section>
      ) : null}

      {horsFenetreConfirmée && (
        <div className="rounded-[var(--radius-md)] border border-[var(--color-warning)] bg-[color-mix(in_srgb,var(--color-warning)_12%,white)] p-4 text-sm space-y-2">
          <p className="font-semibold text-[var(--color-warning)]">Scanner indisponible pour l’instant</p>
          <p className="text-[var(--color-text-secondary)]">
            Fenêtre de validation : <strong>{fenetreLabel}</strong>
          </p>
        </div>
      )}

      {bloqueParPriorite && (
        <div className="rounded-[var(--radius-md)] border border-[var(--color-warning)] bg-[color-mix(in_srgb,var(--color-warning)_12%,white)] p-4 text-sm space-y-2">
          <p className="font-semibold text-[var(--color-warning)]">Un seul créneau scannable à la fois</p>
          <p className="text-[var(--color-text-secondary)]">
            Valide d&apos;abord{" "}
            <strong>
              {reservation.priorite_heure
                ? String(reservation.priorite_heure).slice(0, 5).replace(":", "h")
                : "le créneau prioritaire"}
            </strong>
            {reservation.priorite_joueur ? ` (${reservation.priorite_joueur})` : ""}, puis celui-ci.
          </p>
        </div>
      )}

      {canResendPaymentLink && (
        <button
          type="button"
          onClick={handleResendPaymentLink}
          disabled={resending || confirmingManual}
          className="w-full min-h-[52px] rounded-[var(--radius-md)] bg-[#25D366] text-white text-sm font-medium inline-flex items-center justify-center gap-2 disabled:opacity-60"
        >
          <MessageCircle className="w-5 h-5" />
          {resending ? "Envoi en cours..." : "Renvoyer le lien WhatsApp"}
        </button>
      )}

      {canConfirmManual && (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setConfirmManualOpen(true)}
            disabled={confirmingManual}
            className="w-full min-h-[52px] rounded-[var(--radius-md)] text-white text-sm font-semibold disabled:opacity-60"
            style={{ background: "var(--g-warning, #d97706)" }}
          >
            {confirmingManual ? "Confirmation…" : "Confirmer manuellement (avance déjà reçue)"}
          </button>
          <p className="text-xs text-center" style={{ color: "var(--color-text-muted)" }}>
            À utiliser seulement si le joueur a déjà payé l&apos;avance (espèces, Wave, OM…).
            La commission TerrainSN sera mise en dette.
          </p>
        </div>
      )}

      {canResendQr && (
        <button
          type="button"
          onClick={handleResendQr}
          disabled={sendingQr}
          className="w-full min-h-[52px] rounded-[var(--radius-md)] bg-[#25D366] text-white text-sm font-medium inline-flex items-center justify-center gap-2 disabled:opacity-60"
        >
          <MessageCircle className="w-5 h-5" />
          {sendingQr ? "Envoi du QR..." : "Renvoyer confirmation + QR au joueur"}
        </button>
      )}

      {!hideScanner && canValidateEntree && (
        <>
          {canScan ? (
            <button
              type="button"
              onClick={() => setScannerOpen(true)}
              className="w-full min-h-[52px] rounded-xl text-white text-sm font-semibold animate-pulse"
              style={{ background: "var(--g-primary)" }}
            >
              📷 Valider l&apos;entrée — Scanner QR
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setManualOpen(true)}
            disabled={bloqueParPriorite}
            className="w-full min-h-[48px] rounded-[var(--radius-md)] border border-[var(--color-primary)] text-[var(--color-primary)] text-sm font-medium disabled:opacity-50"
          >
            Valider l&apos;entrée manuellement
          </button>
          {bloqueParPriorite ? (
            <p className="text-xs text-[var(--color-text-muted)] text-center">
              Un autre créneau est prioritaire — valide-le d&apos;abord.
            </p>
          ) : null}
        </>
      )}

      {canAnnuler && (
        <button
          type="button"
          onClick={() => void openCancelConfirm()}
          disabled={cancelling}
          className="w-full min-h-[48px] rounded-[var(--radius-md)] border border-[var(--color-danger)] text-[var(--color-danger)] text-sm font-medium disabled:opacity-60"
        >
          {cancelling ? "Annulation…" : "Annuler la réservation"}
        </button>
      )}

      <ScannerModal
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        expectedReservationId={reservation.id}
        expectedCodeReservation={reservation.code_reservation}
        onSuccess={() => {
          setScannerOpen(false);
          load();
        }}
        onManualValidation={() => {
          setScannerOpen(false);
          setManualOpen(true);
        }}
      />

      <ValidationManuelleModal
        open={manualOpen}
        onClose={() => setManualOpen(false)}
        reservations={[
          {
            id: reservation.id,
            code_reservation: reservation.code_reservation,
            joueur_nom: reservation.joueur_nom,
            joueur_telephone: reservation.joueur_telephone,
            heure_debut: reservation.heure_debut,
            heure_fin: reservation.heure_fin,
            statut: reservation.statut,
            qr_code_scanne_at: reservation.qr_code_scanne_at,
            montant_restant: reservation.montant_restant,
          },
        ]}
        preselectedId={reservation.id}
        onSuccess={() => {
          load();
        }}
      />

      <LierJoueurModal
        open={lierOpen}
        reservationId={reservation.id}
        defaultName={reservation.joueur_nom}
        defaultPhone={reservation.joueur_telephone}
        onClose={() => setLierOpen(false)}
        onLinked={load}
      />

      <ConfirmationModal
        ouvert={confirmCancel}
        titre={reservation.politique_remboursement?.titre || "Annuler cette réservation ?"}
        texte={
          [
            reservation.politique_remboursement?.type_annulation === "avec_remboursement"
              ? "Type : avec remboursement"
              : "Type : sans remboursement",
            reservation.politique_remboursement?.delai_heures != null &&
            Number(reservation.politique_remboursement.delai_heures) > 0
              ? `Délai terrain : ${reservation.politique_remboursement.delai_heures} h après confirmation`
              : null,
            reservation.politique_remboursement?.message ||
              "Le créneau sera libéré. Le remboursement dépend de la politique de ce terrain. Une notification WhatsApp sera envoyée.",
          ]
            .filter(Boolean)
            .join("\n\n")
        }
        labelAnnuler="Garder la réservation"
        labelConfirmer={cancelling ? "Annulation…" : "Oui, annuler — créneau libéré"}
        variante={
          reservation.politique_remboursement?.type_annulation === "avec_remboursement"
            ? "warning"
            : "danger"
        }
        onAnnuler={() => setConfirmCancel(false)}
        onConfirmer={() => void handleAnnuler()}
      />

      <ConfirmationModal
        ouvert={confirmEncaisser}
        titre="Encaisser le reste sur place ?"
        texte={`Tu vas enregistrer un encaissement de ${formatFcfa(reste)} (${methode.replace("_", " ")}). Vérifie le montant avant de confirmer.`}
        labelAnnuler="Annuler"
        labelConfirmer={encaissing ? "Encaissement…" : `Confirmer ${formatFcfa(reste)}`}
        variante="warning"
        onAnnuler={() => setConfirmEncaisser(false)}
        onConfirmer={() => void handleEncaisser()}
      />

      <ConfirmationModal
        ouvert={confirmManualOpen}
        titre="Confirmer cette réservation manuellement ?"
        texte={[
          "Tu confirmes que l’avance a déjà été reçue hors PayTech (espèces, Wave, Orange Money…).",
          `Avance attendue : ${formatFcfa(reservation.montant_avance)}.`,
          "Le créneau sera verrouillé, le joueur recevra son QR, et la commission TerrainSN sera ajoutée à ta dette du mois.",
        ].join("\n\n")}
        labelAnnuler="Annuler"
        labelConfirmer={confirmingManual ? "Confirmation…" : "Oui, confirmer"}
        variante="warning"
        onAnnuler={() => {
          if (!confirmingManual) setConfirmManualOpen(false);
        }}
        onConfirmer={() => void handleConfirmManual()}
      />
    </div>
  );
}
