import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Check, Loader2 } from "lucide-react";
import { reservationsApi } from "@/lib/api";
import { PageConfirmationSansAvance } from "./PageConfirmationSansAvance";

const STATUTS_CONFIRMES = new Set(["confirme", "match_joue", "joue", "acceptee"]);
const STATUTS_ATTENTE = new Set(["en_attente", "en_attente_paiement"]);
/** Polling IPN borné (~2,5 min à 3 s d’intervalle) */
const POLL_MS = 3000;
const POLL_MAX = 50;

const ReservationSuccess = () => {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [reservation, setReservation] = useState<any>(null);
  const [error, setError] = useState("");
  const [showAnim, setShowAnim] = useState(true);
  const [polling, setPolling] = useState(false);
  const [pollTimedOut, setPollTimedOut] = useState(false);
  const pollsRef = useRef(0);

  const reservationId =
    params.get("id") || localStorage.getItem("terrainsn_last_reservation_id") || "";

  useEffect(() => {
    if (!reservationId) {
      setError("Réservation introuvable");
      return;
    }
    let cancelled = false;
    reservationsApi
      .get(reservationId)
      .then((data) => {
        if (!cancelled) setReservation(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [reservationId]);

  useEffect(() => {
    const t = setTimeout(() => setShowAnim(false), 1500);
    return () => clearTimeout(t);
  }, []);

  // Polling borné tant que le webhook PayTech n'a pas confirmé
  useEffect(() => {
    if (!reservationId || !reservation) return;
    const statut = String(reservation.statut || "");
    if (!STATUTS_ATTENTE.has(statut)) {
      setPolling(false);
      setPollTimedOut(false);
      return;
    }
    setPolling(true);
    pollsRef.current = 0;
    const id = window.setInterval(() => {
      pollsRef.current += 1;
      if (pollsRef.current > POLL_MAX) {
        window.clearInterval(id);
        setPolling(false);
        setPollTimedOut(true);
        return;
      }
      reservationsApi
        .get(reservationId)
        .then((data) => setReservation(data))
        .catch(() => {
          /* ignore — on continue le polling */
        });
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [reservationId, reservation?.statut]);

  if (error) {
    return (
      <div className="page-container flex items-center justify-center">
        <p className="text-sm text-[var(--color-text-secondary)]">{error}</p>
      </div>
    );
  }

  if (!reservation) {
    return (
      <div className="page-container flex items-center justify-center gap-2">
        <div className="skeleton w-10 h-10 rounded-full" />
        <p className="text-sm text-[var(--color-text-muted)]">Vérification...</p>
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

  const statut = String(reservation.statut || "");
  const enAttente = STATUTS_ATTENTE.has(statut);
  const confirme = STATUTS_CONFIRMES.has(statut);
  const sansAvance =
    params.get("sans_avance") === "1" ||
    reservation.sans_avance === true ||
    reservation.mode_paiement === "sans_avance";

  // Mode sans avance : page dédiée (aucune mention de paiement en ligne)
  if (sansAvance && confirme) {
    return <PageConfirmationSansAvance reservation={reservation} />;
  }

  const avance = Number(reservation.montant_avance || reservation.acompte || 0);
  const reste = Number(reservation.montant_restant || reservation.reste_a_payer || 0);
  const total = Number(reservation.prix_total || reservation.montant || reste || 0);

  return (
    <div className="page-container flex items-center justify-center p-5 page-enter">
      <div className="bg-[var(--surface)] max-w-md w-full rounded-[var(--radius-xl)] shadow-[var(--shadow-lg)] overflow-hidden border border-[var(--color-border)]">
        <div className="bg-[var(--color-primary-glow)] px-6 py-5 text-center">
          <h1
            className="text-[20px] font-bold text-[var(--color-primary)]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {pollTimedOut && enAttente
              ? "Confirmation en attente"
              : enAttente
                ? "Paiement en cours de confirmation..."
                : confirme
                  ? "Confirmé !"
                  : "Réservation enregistrée"}
          </h1>
          {sansAvance && confirme ? (
            <p className="mt-2 text-[13px] text-[var(--color-text-secondary)]">
              Tu paieras {total.toLocaleString()} FCFA sur place le jour du match.
            </p>
          ) : null}
        </div>

        <div className="p-6 text-center space-y-4">
          <div>
            <p className="font-semibold text-sm">{reservation.terrain_nom}</p>
            <p className="text-[13px] text-[var(--color-text-muted)] mt-1">
              {reservation.date} · {reservation.heure_debut} – {reservation.heure_fin}
            </p>
          </div>

          {enAttente && polling ? (
            <div className="flex flex-col items-center gap-3 py-4">
              <Loader2 className="w-8 h-8 animate-spin text-[var(--color-primary)]" />
              <p className="text-[13px] text-[var(--color-text-secondary)]">
                On attend la confirmation du paiement…
              </p>
            </div>
          ) : null}

          {enAttente && pollTimedOut ? (
            <div className="rounded-[var(--radius-md)] bg-[var(--color-warning-bg,rgba(180,120,0,0.12))] py-4 px-3 space-y-2">
              <p className="text-[14px] font-medium text-[var(--color-text)]">
                La confirmation tarde un peu
              </p>
              <p className="text-[12px] text-[var(--color-text-muted)]">
                Si tu as bien payé (Wave / Orange Money), ta réservation sera confirmée dès réception
                du paiement. Tu peux aussi ouvrir Mes réservations ou contacter le support TerrainSN.
              </p>
              <button
                type="button"
                className="text-[13px] font-medium text-[var(--color-primary)] underline"
                onClick={() => {
                  setPollTimedOut(false);
                  setPolling(true);
                  pollsRef.current = 0;
                  reservationsApi.get(reservationId).then(setReservation).catch(() => undefined);
                }}
              >
                Réessayer
              </button>
            </div>
          ) : null}

          {confirme ? (
            <div className="rounded-[var(--radius-md)] bg-[var(--color-primary-glow)] py-4 px-3">
              <p className="text-[14px] font-medium text-[var(--color-primary)]">
                Ton QR code arrive par WhatsApp
              </p>
              <p className="text-[12px] text-[var(--color-text-muted)] mt-1">
                Le code de réservation t&apos;est envoyé uniquement par WhatsApp.
              </p>
            </div>
          ) : null}

          {confirme && !sansAvance ? (
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
          ) : null}

          {confirme && sansAvance ? (
            <div className="text-left space-y-2 text-sm border-t border-[var(--color-border)] pt-4">
              <p className="flex justify-between">
                <span className="text-[var(--color-text-secondary)]">À régler sur place</span>
                <span className="font-semibold text-[var(--color-primary)]">
                  {total.toLocaleString()} FCFA
                </span>
              </p>
            </div>
          ) : null}

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
