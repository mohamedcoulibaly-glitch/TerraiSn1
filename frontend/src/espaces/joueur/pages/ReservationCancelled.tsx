import { useEffect, useState } from 'react';
import { XCircle } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { reservationsApi } from '@/lib/api';

const PENDING_PAYMENT_KEY = 'terrainsn_pending_payment_id';

const ReservationCancelled = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const terrainId = params.get('terrain_id');
  const reservationId = params.get('id') || sessionStorage.getItem(PENDING_PAYMENT_KEY);
  const [liberating, setLiberating] = useState(Boolean(reservationId));

  useEffect(() => {
    let cancelled = false;
    const liberer = async () => {
      if (!reservationId) {
        setLiberating(false);
        return;
      }
      sessionStorage.removeItem(PENDING_PAYMENT_KEY);
      try {
        const resa = (await reservationsApi.get(reservationId)) as { statut?: string };
        if (resa?.statut === 'en_attente') {
          await reservationsApi.annuler(reservationId);
        }
      } catch {
        // déjà annulée côté /paytech/cancel ou expirée
      } finally {
        if (!cancelled) setLiberating(false);
      }
    };
    void liberer();
    return () => {
      cancelled = true;
    };
  }, [reservationId]);

  return (
    <div className="page-container flex items-center justify-center p-5">
      <div className="glass-card max-w-md w-full p-6 text-center">
        <XCircle className="w-16 h-16 text-destructive mx-auto mb-4" />
        <h1 className="font-display text-2xl font-bold">Paiement annulé</h1>
        <p className="my-5 text-muted-foreground">
          {liberating
            ? 'Libération du créneau…'
            : "Votre réservation n'a pas été confirmée. Le créneau est de nouveau disponible."}
        </p>
        <Button
          className="w-full"
          disabled={liberating}
          onClick={() => navigate(terrainId ? `/terrain/${terrainId}` : '/explorer')}
        >
          Retour au terrain
        </Button>
      </div>
    </div>
  );
};

export default ReservationCancelled;
