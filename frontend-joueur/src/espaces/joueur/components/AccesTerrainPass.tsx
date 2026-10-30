import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useEffect, useState } from "react";
import { fetchReservationQrDataUrl } from "@/lib/api";
import { reservationAfficheQr } from "@/lib/reservationVisibilite";
import { urlMedia } from "@/lib/urlMedia";

export type AccesTerrainReservation = {
  id: number;
  terrain_nom?: string;
  terrain_ville?: string;
  adresse?: string;
  date?: string;
  heure_debut?: string;
  heure_fin?: string;
  statut?: string;
  code_reservation?: string | null;
  qr_code_data_url?: string | null;
  qr_code_url?: string | null;
};

type Props = {
  reservation: AccesTerrainReservation | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  offline?: boolean;
};

/** Passe d'accès affichable hors-ligne (QR data URL + code). */
export default function AccesTerrainPass({ reservation, open, onOpenChange, offline }: Props) {
  const [fetchedQr, setFetchedQr] = useState<string | null>(null);
  const [qrFailed, setQrFailed] = useState(false);
  const reservationId = reservation?.id;
  const canShow = reservationAfficheQr(reservation?.statut);

  useEffect(() => {
    let cancelled = false;
    setFetchedQr(null);
    setQrFailed(false);
    // Le PNG est généré par l'API à la demande. Cela évite de dépendre d'une
    // URL /uploads relative au frontend ou d'un disque éphémère en production.
    if (!open || !canShow || !reservationId || reservation?.qr_code_data_url) return undefined;
    void fetchReservationQrDataUrl(reservationId).then((dataUrl) => {
      if (cancelled) return;
      if (dataUrl) setFetchedQr(dataUrl);
      else setQrFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [open, canShow, reservationId, reservation?.qr_code_data_url]);

  if (!reservation) return null;

  const qrSrc =
    reservation.qr_code_data_url ||
    fetchedQr ||
    (reservation.qr_code_url ? urlMedia(reservation.qr_code_url) : null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm mx-4">
        <DialogHeader>
          <DialogTitle style={{ fontFamily: "var(--font-display)" }}>Accès terrain</DialogTitle>
          <DialogDescription>
            Montre ce QR au gérant à l’entrée
            {offline ? " — disponible hors-ligne" : ""}
          </DialogDescription>
        </DialogHeader>

        {!canShow ? (
          <p className="text-sm text-[var(--color-text-muted)] py-4 text-center">
            La réservation n’est pas encore confirmée.
          </p>
        ) : (
          <div className="space-y-4 text-center py-1">
            <div>
              <p className="font-semibold text-sm">{reservation.terrain_nom}</p>
              <p className="text-[12px] text-[var(--color-text-muted)] mt-1">
                {[reservation.terrain_ville, reservation.adresse].filter(Boolean).join(" · ")}
              </p>
              <p className="text-[13px] text-[var(--color-text-secondary)] mt-2">
                {reservation.date} · {reservation.heure_debut} – {reservation.heure_fin}
              </p>
            </div>

            {qrSrc && !qrFailed ? (
              <div className="inline-block p-3 border-2 border-[var(--color-primary)] rounded-[var(--radius-lg)] bg-[var(--surface)]">
                <img
                  src={qrSrc}
                  alt="QR d'accès terrain"
                  className="w-[min(200px,calc(100vw-7rem))] h-[min(200px,calc(100vw-7rem))] object-contain mx-auto"
                  onError={() => setQrFailed(true)}
                />
              </div>
            ) : (
              <div className="rounded-[var(--radius-md)] bg-[var(--color-primary-glow)] py-6 px-3">
                <p className="text-sm text-[var(--color-text-muted)] px-2">
                  {offline
                    ? "QR non synchronisé. Reconnecte-toi une fois pour le télécharger."
                    : qrFailed
                      ? "Impossible de charger le QR pour le moment. Réessaie dans quelques secondes."
                      : "QR en cours de préparation…"}
                </p>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
