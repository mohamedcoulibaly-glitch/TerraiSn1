import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Check, Download, Loader2, XCircle } from "lucide-react";
import { reservationsApi } from "@/lib/api";

const API_URL = import.meta.env.VITE_API_URL || "/api";

type PaymentPhase = "loading" | "pending" | "confirmed" | "cancelled" | "error";

const ReservationSuccess = () => {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [reservation, setReservation] = useState<any>(null);
  const [error, setError] = useState("");
  const [phase, setPhase] = useState<PaymentPhase>("loading");
  const [showAnim, setShowAnim] = useState(false);
  const [qrFetched, setQrFetched] = useState<string | null>(null);

  useEffect(() => {
    const id = params.get("id") || localStorage.getItem("terrainsn_last_reservation_id");
    if (!id) {
      setError("Réservation introuvable");
      setPhase("error");
      return;
    }

    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 20;

    const load = async () => {
      try {
        const data = await reservationsApi.get(id);
        if (cancelled) return;
        setReservation(data);
        setError("");

        if (data?.statut === "confirme") {
          setPhase("confirmed");
          setShowAnim(true);
          return;
        }
        if (data?.statut === "annule") {
          setPhase("cancelled");
          return;
        }
        if (data?.statut === "en_attente" && attempts < maxAttempts) {
          setPhase("pending");
          attempts += 1;
          setTimeout(load, 1500);
          return;
        }
        // Timeout IPN : reste en attente, pas de faux "confirmé"
        setPhase("pending");
      } catch (err) {
        if (!cancelled) {
          setError((err as Error).message || "Réservation introuvable");
          setPhase("error");
        }
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [params]);

  useEffect(() => {
    if (!showAnim) return;
    const t = setTimeout(() => setShowAnim(false), 1500);
    return () => clearTimeout(t);
  }, [showAnim]);

  useEffect(() => {
    let objectUrl: string | null = null;
    const loadQr = async () => {
      if (!reservation?.id || !reservation?.code_reservation || phase !== "confirmed") {
        setQrFetched(null);
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
        setQrFetched(objectUrl);
      } catch {
        setQrFetched(null);
      }
    };
    loadQr();
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [reservation?.id, reservation?.code_reservation, phase]);

  if (phase === "error" || error) {
    return (
      <div className="page-container flex items-center justify-center">
        <p className="text-sm text-[var(--color-text-secondary)]">{error || "Erreur"}</p>
      </div>
    );
  }

  if (phase === "loading" || !reservation) {
    return (
      <div className="page-container flex items-center justify-center gap-2">
        <div className="skeleton w-10 h-10 rounded-full" />
        <p className="text-sm text-[var(--color-text-muted)]">Vérification du paiement...</p>
      </div>
    );
  }

  if (phase === "pending") {
    return (
      <div className="page-container flex items-center justify-center p-5 page-enter">
        <div className="bg-[var(--surface)] max-w-md w-full rounded-[var(--radius-xl)] shadow-[var(--shadow-lg)] overflow-hidden border border-[var(--color-border)] p-6 text-center space-y-4">
          <Loader2 className="w-12 h-12 mx-auto text-[var(--color-primary)] animate-spin" />
          <h1 className="text-[18px] font-bold" style={{ fontFamily: "var(--font-display)" }}>
            Paiement en cours…
          </h1>
          <p className="text-[13px] text-[var(--color-text-muted)]">
            Nous attendons la confirmation de la passerelle. Cette page se met à jour automatiquement.
          </p>
          <button
            type="button"
            onClick={() => navigate("/reservations")}
            className="w-full h-12 rounded-[var(--radius-md)] border border-[var(--color-border)] text-sm font-medium"
          >
            Voir mes réservations
          </button>
        </div>
      </div>
    );
  }

  if (phase === "cancelled") {
    return (
      <div className="page-container flex items-center justify-center p-5 page-enter">
        <div className="bg-[var(--surface)] max-w-md w-full rounded-[var(--radius-xl)] border border-[var(--color-border)] p-6 text-center space-y-4">
          <XCircle className="w-12 h-12 mx-auto text-[var(--color-danger,#c0392b)]" />
          <h1 className="text-[18px] font-bold" style={{ fontFamily: "var(--font-display)" }}>
            Paiement non confirmé
          </h1>
          <p className="text-[13px] text-[var(--color-text-muted)]">
            La réservation a été annulée ou le paiement a échoué. Tu peux réessayer depuis Mes réservations.
          </p>
          <button
            type="button"
            onClick={() => navigate("/reservations")}
            className="w-full h-12 rounded-[var(--radius-md)] bg-[var(--color-primary)] text-white text-sm font-medium"
          >
            Mes réservations
          </button>
        </div>
      </div>
    );
  }

  if (showAnim) {
    return (
      <div className="fixed inset-0 z-50 bg-[var(--surface)] flex items-center justify-center">
        <div className="relative flex items-center justify-center">
          <div className="absolute w-28 h-28 rounded-full bg-[var(--color-primary)]/20 animate-ping" />
          <div className="w-20 h-20 rounded-full bg-[var(--color-primary)] flex items-center justify-center shadow-[var(--shadow-lg)]">
            <Check className="w-12 h-12 text-white" strokeWidth={3} />
          </div>
        </div>
      </div>
    );
  }

  const avance = Number(reservation.montant_avance || reservation.acompte || 0);
  const reste = Number(reservation.montant_restant || reservation.reste_a_payer || 0);
  const qrUrl = qrFetched || reservation.qr_code_url;

  return (
    <div className="page-container flex items-center justify-center p-5 page-enter">
      <div className="bg-[var(--surface)] max-w-md w-full rounded-[var(--radius-xl)] shadow-[var(--shadow-lg)] overflow-hidden border border-[var(--color-border)]">
        <div className="bg-[var(--color-primary-glow)] px-6 py-5 text-center">
          <h1 className="text-[20px] font-bold text-[var(--color-primary)]" style={{ fontFamily: "var(--font-display)" }}>
            C'est confirmé !
          </h1>
        </div>

        <div className="p-6 text-center space-y-4">
          <div>
            <p className="font-semibold text-sm">{reservation.terrain_nom}</p>
            <p className="text-[13px] text-[var(--color-text-muted)] mt-1">
              {reservation.date} · {reservation.heure_debut} – {reservation.heure_fin}
            </p>
          </div>

          {reservation.code_reservation && (
            <div className="rounded-[var(--radius-md)] bg-[var(--color-primary-glow)] py-4 px-3">
              <p className="text-[11px] uppercase tracking-wide text-[var(--color-text-muted)]">Code réservation</p>
              <p className="text-[28px] font-bold text-[var(--color-primary)] mt-1" style={{ fontFamily: "var(--font-display)" }}>
                {reservation.code_reservation}
              </p>
            </div>
          )}

          {qrUrl && (
            <div className="inline-block p-3 border-2 border-[var(--color-primary)] rounded-[var(--radius-lg)] bg-[var(--surface)]">
              <img src={qrUrl} alt="QR code" className="w-[180px] h-[180px] object-contain" />
            </div>
          )}
          <p className="text-[12px] text-[var(--color-text-muted)]">
            Montre ce QR code au gérant le jour du match
          </p>

          <div className="text-left space-y-2 text-sm border-t border-[var(--color-border)] pt-4">
            <p className="flex justify-between">
              <span className="text-[var(--color-success)] font-medium">Avance payée</span>
              <span className="text-[var(--color-success)]">{avance.toLocaleString()} FCFA</span>
            </p>
            <p className="flex justify-between">
              <span className="text-[var(--color-text-secondary)]">Reste à payer sur place</span>
              <span className="text-[var(--color-text-secondary)]">{reste.toLocaleString()} FCFA</span>
            </p>
          </div>

          {qrUrl && (
            <a
              href={qrUrl}
              download
              className="flex items-center justify-center gap-2 w-full h-12 rounded-[var(--radius-md)] border-2 border-[var(--color-primary)] text-[var(--color-primary)] text-sm font-medium"
            >
              <Download className="w-4 h-4" />
              Télécharger le QR code
            </a>
          )}

          <button
            type="button"
            onClick={() => navigate("/reservations")}
            className="w-full h-12 rounded-[var(--radius-md)] bg-[var(--color-primary)] text-white text-sm font-medium"
          >
            Voir mes réservations
          </button>
        </div>
      </div>
    </div>
  );
};

export default ReservationSuccess;
