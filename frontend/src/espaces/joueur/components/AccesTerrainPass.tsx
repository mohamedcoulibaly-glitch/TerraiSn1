import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { reservationHasStadiumAccess } from "@/lib/offlineStore";

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
  if (!reservation) return null;

  const qrSrc = reservation.qr_code_data_url || reservation.qr_code_url || null;
  const canShow = reservationHasStadiumAccess(reservation.statut);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm mx-4">
        <DialogHeader>
          <DialogTitle style={{ fontFamily: "var(--font-display)" }}>Accès terrain</DialogTitle>
          <DialogDescription>
            Montre ce code au gérant à l’entrée
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

            {reservation.code_reservation ? (
              <div className="rounded-[var(--radius-md)] bg-[var(--color-primary-glow)] py-3 px-3">
                <p className="text-[11px] uppercase tracking-wide text-[var(--color-text-muted)]">
                  Code réservation
                </p>
                <p
                  className="text-[26px] font-bold text-[var(--color-primary)] mt-0.5 tracking-wide"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  {reservation.code_reservation}
                </p>
              </div>
            ) : null}

            {qrSrc ? (
              <div className="inline-block p-3 border-2 border-[var(--color-primary)] rounded-[var(--radius-lg)] bg-[var(--surface)]">
                <img
                  src={qrSrc}
                  alt={`QR ${reservation.code_reservation || reservation.id}`}
                  className="w-[200px] h-[200px] object-contain mx-auto"
                />
              </div>
            ) : (
              <p className="text-sm text-[var(--color-text-muted)] px-2">
                {offline
                  ? "QR non synchronisé. Reconnecte-toi une fois pour le télécharger, le code ci-dessus reste valable."
                  : "QR en cours de préparation…"}
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
