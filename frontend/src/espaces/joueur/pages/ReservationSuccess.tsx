import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2 } from 'lucide-react';
import { reservationsApi } from '@/lib/api';
import { Button } from '@/components/ui/button';

const ReservationSuccess = () => {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [reservation, setReservation] = useState<any>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const id = params.get('id') || localStorage.getItem('terrainsn_last_reservation_id');
    if (!id) return setError('Réservation introuvable');
    reservationsApi.get(id).then(setReservation).catch((err) => setError(err.message));
  }, [params]);

  if (error) return <div className="page-container flex items-center justify-center"><p>{error}</p></div>;
  if (!reservation) return <div className="page-container flex items-center justify-center"><p>Vérification du paiement...</p></div>;

  return (
    <div className="page-container flex items-center justify-center p-5">
      <div className="glass-card max-w-md w-full p-6 text-center">
        <CheckCircle2 className="w-16 h-16 text-accent mx-auto mb-4" />
        <h1 className="font-display text-2xl font-bold">Réservation confirmée</h1>
        <p className="mt-4 font-semibold">{reservation.terrain_nom}</p>
        <p className="text-muted-foreground">{reservation.date} · {reservation.heure_debut} - {reservation.heure_fin}</p>
        <p className="mt-2 text-sm">Acompte payé : <strong>{Number(reservation.acompte || 0).toLocaleString()} CFA</strong></p>
        <p className="text-sm text-muted-foreground">Reste à payer après le match : {Number(reservation.reste_a_payer || 0).toLocaleString()} CFA</p>
        {reservation.code_reservation ? (
          <div className="my-6 rounded-xl bg-primary/10 p-5">
            <p className="text-xs uppercase text-muted-foreground">Votre code</p>
            <p className="font-display text-3xl font-bold text-primary">{reservation.code_reservation}</p>
          </div>
        ) : <p className="my-6 text-sm">Paiement reçu, confirmation en cours...</p>}
        <Button className="w-full" onClick={() => navigate('/reservations')}>Mes réservations</Button>
      </div>
    </div>
  );
};

export default ReservationSuccess;
