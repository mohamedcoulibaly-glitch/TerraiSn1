import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, CheckCircle2, Link2, MessageCircle, Phone, QrCode, ShieldCheck } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { gerantApi, reservationsApi } from "@/lib/api";
import ScannerModal from "@/espaces/backoffice/components/ScannerModal";
import ValidationManuelleModal from "@/espaces/backoffice/components/ValidationManuelleModal";
import LierJoueurModal from "@/espaces/backoffice/modules/crm/ui/LierJoueurModal";
import { toast } from "sonner";
import { estDansLaFenetreCheckIn } from "@/lib/checkInFenetre";

const API_URL = import.meta.env.VITE_API_URL || "/api";

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
  operational_stage?: string;
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
    label: "En attente de paiement",
    className: "bg-[color-mix(in_srgb,var(--color-warning)_16%,white)] text-[var(--color-warning)]",
  },
  annule: {
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

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  const raw = String(value).trim();
  const date = new Date(raw.includes("T") ? raw : raw.replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
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
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [methode, setMethode] = useState<"especes" | "wave" | "orange_money">("especes");

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
    let objectUrl: string | null = null;
    const loadQr = async () => {
      if (!reservation?.id || !reservation?.code_reservation) {
        setQrUrl(null);
        return;
      }
      try {
        const token = localStorage.getItem("terrainsn_token");
        const res = await fetch(`${API_URL}/reservations/${reservation.id}/qr.png`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error("QR indisponible");
        const blob = await res.blob();
        objectUrl = URL.createObjectURL(blob);
        setQrUrl(objectUrl);
      } catch {
        setQrUrl(null);
      }
    };
    loadQr();
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [reservation?.id, reservation?.code_reservation]);

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
  const alreadyScanned =
    Boolean(reservation.qr_code_scanne_at) || ["match_joue", "joue"].includes(reservation.statut);
  const reste = Number(reservation.montant_restant || 0);

  const dansFenetre = estDansLaFenetreCheckIn({
    date: reservation.date,
    heure_debut: reservation.heure_debut,
    heure_fin: reservation.heure_fin,
    fenetre_retard: reservation.fenetre_retard,
  });

  const canScan =
    reservation.statut === "confirme" && !reservation.qr_code_scanne_at && dansFenetre;
  const canResendPaymentLink = reservation.statut === "en_attente";
  const canResendQr =
    Boolean(reservation.code_reservation) &&
    ["confirme", "acceptee"].includes(reservation.statut) &&
    !alreadyScanned;
  const horsFenetreConfirmée =
    reservation.statut === "confirme" && !reservation.qr_code_scanne_at && !dansFenetre;
  const canEncaisser =
    reste > 0 && ["confirme", "acceptee", "match_joue", "joue"].includes(reservation.statut);
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
    setResending(true);
    try {
      await reservationsApi.renvoyerLienWhatsApp(reservation.id);
      toast.success("Lien de paiement renvoyé par WhatsApp");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Envoi WhatsApp impossible");
    } finally {
      setResending(false);
    }
  };

  const handleResendQr = async () => {
    setSendingQr(true);
    try {
      await reservationsApi.renvoyerConfirmationWhatsApp(reservation.id);
      toast.success("Confirmation + QR envoyés au joueur sur WhatsApp");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Envoi WhatsApp impossible");
    } finally {
      setSendingQr(false);
    }
  };

  const handleEncaisser = async () => {
    setEncaissing(true);
    try {
      await gerantApi.encaisserRestant(reservation.id, methode);
      toast.success(`Reste encaissé (${methode.replace("_", " ")})`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Encaissement impossible");
    } finally {
      setEncaissing(false);
    }
  };

  const handleAnnuler = async () => {
    if (!window.confirm("Annuler cette réservation ? Le créneau sera libéré côté joueur.")) return;
    setCancelling(true);
    try {
      await reservationsApi.annulerGerant(reservation.id);
      toast.success("Réservation annulée — créneau libéré");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Annulation impossible");
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto space-y-5 p-4">
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-2 text-sm text-[var(--color-text-secondary)] min-h-[44px]"
        >
          <ArrowLeft className="w-4 h-4" /> Retour
        </button>
        <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${badge.className}`}>
          {badge.label}
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
          {reservation.code_reservation || `Résa #${reservation.id}`}
        </h1>
        {qrUrl && reservation.code_reservation ? (
          <img
            src={qrUrl}
            alt={`QR ${reservation.code_reservation}`}
            className="mx-auto h-44 w-44 rounded-lg bg-white p-2 border border-[var(--color-border)]"
          />
        ) : null}
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
            Non lié à un compte app — le joueur ne verra pas cette résa dans Mes réservations.
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
              onClick={handleEncaisser}
              className="w-full min-h-[48px] rounded-[var(--radius-md)] bg-[var(--color-primary)] text-white text-sm font-medium disabled:opacity-60"
            >
              {encaissing ? "Encaissement…" : `Encaisser ${formatFcfa(reste)}`}
            </button>
          </div>
        ) : null}
      </section>

      <section className="bg-white rounded-[var(--radius-md)] border border-[var(--color-border)] p-4 space-y-2">
        <h2 className="text-sm font-semibold text-[var(--color-text-primary)] inline-flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-[var(--color-primary)]" />
          Anti-fraude
        </h2>
        {alreadyScanned ? (
          <div className="flex items-start gap-2 text-sm text-[var(--color-text-secondary)]">
            <CheckCircle2 className="w-4 h-4 mt-0.5 text-[var(--color-success)] shrink-0" />
            <p>
              QR scanné le <strong>{formatDateTime(reservation.qr_code_scanne_at)}</strong>.
            </p>
          </div>
        ) : (
          <p className="text-sm text-[var(--color-text-secondary)]">
            Le QR n&apos;a pas encore été scanné.
          </p>
        )}
      </section>

      {horsFenetreConfirmée && (
        <div className="rounded-[var(--radius-md)] border border-[var(--color-warning)] bg-[color-mix(in_srgb,var(--color-warning)_12%,white)] p-4 text-sm space-y-2">
          <p className="font-semibold text-[var(--color-warning)]">Scanner indisponible pour l’instant</p>
          <p className="text-[var(--color-text-secondary)]">
            Fenêtre de validation : <strong>{fenetreLabel}</strong>
          </p>
        </div>
      )}

      {canResendPaymentLink && (
        <button
          type="button"
          onClick={handleResendPaymentLink}
          disabled={resending}
          className="w-full min-h-[52px] rounded-[var(--radius-md)] bg-[#25D366] text-white text-sm font-medium inline-flex items-center justify-center gap-2 disabled:opacity-60"
        >
          <MessageCircle className="w-5 h-5" />
          {resending ? "Envoi en cours..." : "Renvoyer le lien WhatsApp"}
        </button>
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

      {reservation.statut === "confirme" && !alreadyScanned && (
        <>
          <button
            type="button"
            onClick={() => canScan && setScannerOpen(true)}
            disabled={!canScan}
            className="w-full min-h-[52px] rounded-[var(--radius-md)] bg-[var(--color-primary)] text-white text-sm font-medium inline-flex items-center justify-center gap-2 disabled:opacity-45 disabled:cursor-not-allowed"
          >
            <QrCode className="w-5 h-5" />
            {canScan ? "Scanner le joueur" : "Scanner (hors fenêtre de validation)"}
          </button>
          <button
            type="button"
            onClick={() => setManualOpen(true)}
            className="w-full min-h-[48px] rounded-[var(--radius-md)] border border-[var(--color-primary)] text-[var(--color-primary)] text-sm font-medium"
          >
            Valider l&apos;entrée manuellement
          </button>
        </>
      )}

      {canAnnuler && (
        <button
          type="button"
          onClick={handleAnnuler}
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
    </div>
  );
}
