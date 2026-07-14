import { XCircle } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';

const ReservationCancelled = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const terrainId = params.get('terrain_id');
  return (
    <div className="page-container flex items-center justify-center p-5">
      <div className="glass-card max-w-md w-full p-6 text-center">
        <XCircle className="w-16 h-16 text-destructive mx-auto mb-4" />
        <h1 className="font-display text-2xl font-bold">Paiement annulé</h1>
        <p className="my-5 text-muted-foreground">Votre réservation n'a pas été confirmée.</p>
        <Button className="w-full" onClick={() => navigate(terrainId ? `/terrain/${terrainId}` : '/explorer')}>Retour au terrain</Button>
      </div>
    </div>
  );
};

export default ReservationCancelled;
