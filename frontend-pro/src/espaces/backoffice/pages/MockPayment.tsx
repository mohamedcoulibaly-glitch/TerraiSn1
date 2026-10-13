import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CreditCard, ShieldCheck } from 'lucide-react';
import { paiementsApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

const MockPayment = () => {
  const [params] = useSearchParams();
  const [processing, setProcessing] = useState(false);
  const kind = params.get('kind') || 'reservation';
  const reservationId = Number(params.get('id') || 0);
  const gerantId = Number(params.get('gerant_id') || 0);
  const periode = params.get('periode') || '';
  const refCommand = params.get('ref') || '';
  const terrain = params.get('terrain') || (kind === 'dette' ? 'Dette commission' : 'TerrainSN');
  const montant = Number(params.get('montant') || 0);
  const total = Number(params.get('total') || montant);
  const reste = Number(params.get('reste') || 0);
  const isDette = kind === 'dette' || refCommand.startsWith('DETTE-');

  const complete = async (action: 'success' | 'cancel') => {
    setProcessing(true);
    try {
      const result = await paiementsApi.simulateComplete({
        reservation_id: reservationId || undefined,
        gerant_id: gerantId || undefined,
        periode: periode || undefined,
        ref_command: refCommand,
        action,
        montant,
      });
      window.location.assign(result.redirect_url);
    } catch {
      toast.error("Le paiement n'a pas pu être confirmé. Veuillez réessayer.");
      setProcessing(false);
    }
  };

  const lienValide = isDette
    ? Boolean(refCommand && (gerantId || refCommand.startsWith('DETTE-')))
    : Boolean(reservationId && refCommand);

  if (!lienValide) {
    return <div className="page-container flex items-center justify-center">Lien de test invalide</div>;
  }

  return (
    <div className="page-container flex items-center justify-center p-5">
      <div className="glass-card w-full max-w-md p-6">
        <div className="rounded-xl bg-orange-500 p-3 text-center text-sm font-semibold text-white">
          MODE SIMULATION — Ne pas utiliser en production
        </div>
        <CreditCard className="mx-auto mt-6 h-14 w-14 text-primary" />
        <h1 className="mt-3 text-center font-display text-2xl font-bold">
          {isDette ? 'Paiement dette simulé' : 'Paiement PayTech simulé'}
        </h1>
        <div className="my-6 rounded-xl bg-muted p-4">
          <p className="font-semibold">{terrain}</p>
          <p className="mt-1 text-2xl font-bold text-primary">{montant.toLocaleString()} FCFA</p>
          {isDette ? (
            <p className="text-xs text-muted-foreground">
              Solde dette commission{periode ? ` — période ${periode}` : ''}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Avance sur {total.toLocaleString()} FCFA - reste {reste.toLocaleString()} FCFA
            </p>
          )}
          <p className="mt-2 text-xs text-muted-foreground">Référence : {refCommand}</p>
        </div>
        <div className="space-y-3">
          <Button className="w-full" disabled={processing} onClick={() => complete('success')}>
            <ShieldCheck className="mr-2 h-4 w-4" /> {processing ? 'Traitement...' : 'Simuler paiement réussi'}
          </Button>
          <Button className="w-full" variant="outline" disabled={processing} onClick={() => complete('cancel')}>
            Simuler paiement échoué
          </Button>
        </div>
      </div>
    </div>
  );
};

export default MockPayment;
