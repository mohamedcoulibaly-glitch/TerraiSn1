import { useEffect, useState } from "react";
import { Wallet, ArrowDownToLine, Percent, Banknote } from "lucide-react";
import { gerantApi } from "@/lib/api";

type Reversement = {
  reservation_id?: number;
  montant?: number;
  date?: string;
  statut?: string;
};

type PortefeuilleData = {
  solde_disponible: number;
  total_encaisse: number;
  total_commission_prelevee: number;
  historique_reversements: Reversement[];
};

function formatFcfa(value?: number) {
  return `${Number(value || 0).toLocaleString("fr-FR")} FCFA`;
}

function formatDate(value?: string) {
  if (!value) return "-";
  const raw = String(value).trim();
  const date = new Date(raw.includes("T") ? raw : raw.replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statutLabel(statut?: string) {
  if (!statut) return "—";
  if (statut === "effectue" || statut === "paye") return "Effectué";
  if (statut === "en_attente") return "En attente";
  if (statut === "en_retard") return "En retard";
  return statut;
}

function PortefeuilleSkeleton() {
  return (
    <div className="max-w-2xl mx-auto space-y-5 animate-pulse">
      <div className="h-8 w-48 rounded bg-[var(--color-surface-2)]" />
      <div className="h-36 rounded-[var(--radius-lg)] bg-[var(--color-surface-2)]" />
      <div className="grid grid-cols-2 gap-3">
        <div className="h-24 rounded-[var(--radius-md)] bg-[var(--color-surface-2)]" />
        <div className="h-24 rounded-[var(--radius-md)] bg-[var(--color-surface-2)]" />
      </div>
      <div className="h-40 rounded-[var(--radius-md)] bg-[var(--color-surface-2)]" />
    </div>
  );
}

export default function Portefeuille() {
  const [data, setData] = useState<PortefeuilleData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    gerantApi
      .portefeuille()
      .then((payload) => {
        if (!mounted) return;
        setData(payload as PortefeuilleData);
      })
      .catch((err) => {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : "Impossible de charger le portefeuille");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  if (loading) return <PortefeuilleSkeleton />;

  if (error || !data) {
    return (
      <div className="max-w-2xl mx-auto">
        <p className="text-sm text-[var(--color-danger)]">{error || "Portefeuille indisponible"}</p>
      </div>
    );
  }

  const historique = data.historique_reversements || [];

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1
          className="text-xl font-semibold text-[var(--color-text-primary)]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Portefeuille
        </h1>
        <p className="text-sm text-[var(--color-text-secondary)] mt-1">
          Avances reçues, commissions et reversements
        </p>
      </div>

      <section className="rounded-[var(--radius-lg)] bg-[var(--color-primary)] text-white p-5 shadow-sm">
        <div className="flex items-center gap-2 text-white/80 text-sm">
          <Wallet className="w-4 h-4" />
          Solde disponible
        </div>
        <p className="mt-3 text-3xl font-semibold tracking-tight" style={{ fontFamily: "var(--font-display)" }}>
          {formatFcfa(data.solde_disponible)}
        </p>
      </section>

      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white rounded-[var(--radius-md)] border border-[var(--color-border)] p-4">
          <div className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
            <Banknote className="w-3.5 h-3.5 text-[var(--color-accent)]" />
            Total encaissé
          </div>
          <p className="mt-2 text-lg font-semibold" style={{ fontFamily: "var(--font-display)" }}>
            {formatFcfa(data.total_encaisse)}
          </p>
        </div>
        <div className="bg-white rounded-[var(--radius-md)] border border-[var(--color-border)] p-4">
          <div className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
            <Percent className="w-3.5 h-3.5 text-[var(--color-warning)]" />
            Commission prélevée
          </div>
          <p className="mt-2 text-lg font-semibold" style={{ fontFamily: "var(--font-display)" }}>
            {formatFcfa(data.total_commission_prelevee)}
          </p>
        </div>
      </div>

      <section>
        <h2 className="section-title mb-3 inline-flex items-center gap-2">
          <ArrowDownToLine className="w-4 h-4 text-[var(--color-primary)]" />
          Historique des reversements
        </h2>

        {historique.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)] text-center py-8 bg-white rounded-[var(--radius-md)] border border-[var(--color-border)]">
            Aucun reversement pour le moment
          </p>
        ) : (
          <ul className="space-y-2">
            {historique.map((item, index) => (
              <li
                key={`${item.reservation_id || "r"}-${item.date || index}`}
                className="bg-white rounded-[var(--radius-md)] border border-[var(--color-border)] p-3 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold" style={{ fontFamily: "var(--font-display)" }}>
                    {formatFcfa(item.montant)}
                  </p>
                  <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                    Réservation #{item.reservation_id || "—"} · {formatDate(item.date)}
                  </p>
                </div>
                <span className="shrink-0 text-xs font-medium px-2.5 py-1 rounded-full bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]">
                  {statutLabel(item.statut)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
