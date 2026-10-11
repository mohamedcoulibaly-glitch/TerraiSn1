import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Check, Download } from "lucide-react";
import { reservationsApi } from "@/lib/api";

const API_URL = import.meta.env.VITE_API_URL || "/api";

const ReservationSuccess = () => {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [reservation, setReservation] = useState<any>(null);
  const [error, setError] = useState("");
  const [showAnim, setShowAnim] = useState(true);
  const [qrFetched, setQrFetched] = useState<string | null>(null);

  useEffect(() => {
    const id = params.get("id") || localStorage.getItem("terrainsn_last_reservation_id");
    if (!id) return setError("Réservation introuvable");
    reservationsApi.get(id).then(setReservation).catch((err) => setError(err.message));
  }, [params]);

  useEffect(() => {
    const t = setTimeout(() => setShowAnim(false), 1500);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    let objectUrl: string | null = null;
    const loadQr = async () => {
      if (!reservation?.id || !reservation?.code_reservation) {
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
  }, [reservation?.id, reservation?.code_reservation]);

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

  const sansAvance =
    params.get("sans_avance") === "1" ||
    reservation.sans_avance === true ||
    reservation.mode_paiement === "sans_avance";

  const avance = Number(reservation.montant_avance || reservation.acompte || 0);
  const reste = Number(reservation.montant_restant || reservation.reste_a_payer || 0);
  const total = Number(reservation.prix_total || reservation.montant || reste || 0);
  const qrUrl = qrFetched || reservation.qr_code_url;

  return (
    <div className="page-container flex items-center justify-center p-5 page-enter">
      <div className="bg-[var(--surface)] max-w-md w-full rounded-[var(--radius-xl)] shadow-[var(--shadow-lg)] overflow-hidden border border-[var(--color-border)]">
        <div className="bg-[var(--color-primary-glow)] px-6 py-5 text-center">
          <h1 className="text-[20px] font-bold text-[var(--color-primary)]" style={{ fontFamily: "var(--font-display)" }}>
            C'est confirmé !
          </h1>
          {sansAvance ? (
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

          {sansAvance ? (
            <div className="text-left space-y-2 text-sm border-t border-[var(--color-border)] pt-4">
              <p className="flex justify-between">
                <span className="text-[var(--color-text-secondary)]">À régler sur place</span>
                <span className="font-semibold text-[var(--color-primary)]">{total.toLocaleString()} FCFA</span>
              </p>
            </div>
          ) : (
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
          )}

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
