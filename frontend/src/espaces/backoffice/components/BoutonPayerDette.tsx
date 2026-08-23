import { useState } from "react";
import { CreditCard } from "lucide-react";

const API_URL = import.meta.env.VITE_API_URL || "/api";

interface BoutonPayerDetteProps {
  montantDu: number;
  periodeId: string;
  onPaiementReussi: (montantRegle: number, soldeRestant: number) => void;
}

function formaterMontant(n: number) {
  return `${Number(n || 0).toLocaleString("fr-FR")} FCFA`;
}

function authToken() {
  return localStorage.getItem("terrainsn_token") || localStorage.getItem("access_token") || "";
}

/** Shell frontend — Mohamed branche la logique backend POST /gerant/dettes/payer */
export default function BoutonPayerDette({ montantDu, periodeId, onPaiementReussi }: BoutonPayerDetteProps) {
  const [loading, setLoading] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const handlePayer = async () => {
    if (loading || montantDu <= 0) return;
    setLoading(true);
    setErreur(null);
    try {
      const res = await fetch(`${API_URL}/gerant/dettes/payer`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken()}`,
        },
        body: JSON.stringify({ periode: periodeId, montant: montantDu }),
      });

      if (!res.ok) {
        let msg = "Paiement échoué";
        try {
          const body = await res.json();
          if (body?.error) msg = String(body.error);
        } catch {
          /* ignore */
        }
        throw new Error(msg);
      }

      const data = await res.json();
      const montantRegle = Number(data.montant_regle ?? montantDu);
      const soldeRestant = Number(data.solde_restant ?? Math.max(0, montantDu - montantRegle));
      onPaiementReussi(montantRegle, soldeRestant);
    } catch (err) {
      setErreur(err instanceof Error ? err.message : "Paiement impossible pour le moment. Réessaie.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-1 shrink-0">
      <button
        type="button"
        onClick={handlePayer}
        disabled={loading || montantDu <= 0}
        className="flex items-center justify-center gap-2 px-4 h-10 rounded-[10px] font-semibold text-sm text-white disabled:opacity-50"
        style={{ background: "var(--g-primary)" }}
      >
        {loading ? (
          <>
            <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            Traitement...
          </>
        ) : (
          <>
            <CreditCard className="w-4 h-4" />
            Payer
          </>
        )}
      </button>
      {erreur ? (
        <span className="text-xs" style={{ color: "var(--g-danger)" }}>
          {erreur}
        </span>
      ) : null}
      {!erreur && montantDu > 0 ? (
        <span className="text-[10px] text-center" style={{ color: "var(--g-muted)" }}>
          {formaterMontant(montantDu)}
        </span>
      ) : null}
    </div>
  );
}
