import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { useTerrainEvents } from "@/hooks/useTerrainEvents";
import { gerantApi } from "@/lib/api";
import FinancesView, {
  FinancesSkeleton,
  PERIODES_FINANCES,
  type FinancesData,
  type PeriodeFinances,
} from "@/espaces/backoffice/components/FinancesView";
import CommissionDueCard from "@/espaces/backoffice/components/CommissionDueCard";
import { featureEnabled } from "@/lib/terrainFeatures";
import { exportFinancesPdf } from "@/lib/exportFinancesPdf";

type Portefeuille = {
  payout_mode?: "auto" | "retrait";
  solde_disponible?: number;
  solde_net_apres_dette?: number;
  solde_demande_retrait?: number;
  solde_en_fenetre?: number;
  bouton_retirer?: boolean;
  raison_blocage?: string | null;
  message_lisible?: string | null;
  code_blocage?: string | null;
};

function fcfa(amount?: number) {
  return `${Number(amount || 0).toLocaleString("fr-FR")} FCFA`;
}

export default function FinancesPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [periode, setPeriode] = useState<PeriodeFinances>("aujourd_hui");
  const [data, setData] = useState<FinancesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [features, setFeatures] = useState<Record<string, boolean> | null>(null);
  const [portefeuille, setPortefeuille] = useState<Portefeuille | null>(null);
  const [retraitPending, setRetraitPending] = useState(false);
  const [detteRefreshKey, setDetteRefreshKey] = useState(0);
  const refreshTimer = useRef<number | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) {
      setLoading(true);
      setData(null);
    }
    setError("");
    // Portefeuille et KPIs sont indépendants : un 404 finances ne doit pas masquer Retirer.
    const [financesResult, walletResult] = await Promise.allSettled([
      gerantApi.finances(periode),
      gerantApi.portefeuille(),
    ]);
    if (walletResult.status === "fulfilled") {
      setPortefeuille(walletResult.value as Portefeuille);
    } else {
      setPortefeuille(null);
    }
    if (financesResult.status === "fulfilled") {
      setData(financesResult.value as FinancesData);
      setError("");
    } else {
      setData(null);
      const err = financesResult.reason;
      setError(err instanceof Error ? err.message : "Impossible de charger les finances");
    }
    setLoading(false);
  }, [periode]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const status = searchParams.get("paiement_dette");
    if (!status) return;
    if (status === "ok") {
      toast.success("Dette commission réglée");
      setDetteRefreshKey((k) => k + 1);
      load(true);
    } else if (status === "annule") {
      toast.error("Paiement de la dette annulé");
    }
    const next = new URLSearchParams(searchParams);
    next.delete("paiement_dette");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, load]);

  useEffect(() => {
    let mounted = true;
    gerantApi
      .dashboard()
      .then((dash) => {
        if (!mounted) return;
        const f = (dash as { features?: Record<string, boolean> })?.features;
        setFeatures(f && typeof f === "object" ? f : {});
      })
      .catch(() => {
        if (mounted) setFeatures({});
      });
    return () => {
      mounted = false;
    };
  }, []);

  const demanderRetrait = async () => {
    if (retraitPending || !portefeuille?.bouton_retirer) return;
    if (!window.confirm(`Demander le retrait de ${fcfa(portefeuille.solde_net_apres_dette || portefeuille.solde_disponible)} ?`)) return;
    setRetraitPending(true);
    try {
      const result = await gerantApi.demanderRetrait() as { montant?: number; statut?: string };
      toast.success(`Retrait demandé : ${fcfa(result.montant)}. Vous serez notifié à son traitement.`);
      await load(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Impossible de demander le retrait");
    } finally {
      setRetraitPending(false);
    }
  };

  useTerrainEvents(user?.terrain_id, (ev) => {
    if (!["reservation", "encaissement", "blocage", "sante"].includes(String(ev.type))) return;
    if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
    refreshTimer.current = window.setTimeout(() => load(true), 350);
  });

  useEffect(() => {
    return () => {
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
    };
  }, []);

  const periodeLabel = PERIODES_FINANCES.find((p) => p.id === periode)?.label || periode;

  const exporterPdf = () => {
    if (!data) {
      toast.message("Aucune donnée à exporter");
      return;
    }
    try {
      exportFinancesPdf({
        titre: "Bilan financier",
        roleLabel: "Espace gérant",
        terrainLabel: data.historique?.[0]?.terrain_nom || "Terrain actif",
        periodeLabel,
        from: data.from,
        to: data.to,
        total_encaisse: data.total_encaisse,
        avances_recues: data.avances_recues,
        matchs_joues: data.matchs_joues,
        a_venir: data.a_venir,
        historique: data.historique || [],
        par_terrain: data.par_terrain,
        filename: `bilan-gerant-${periode}-${new Date().toISOString().slice(0, 10)}.pdf`,
      });
      toast.success("PDF téléchargé");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export PDF impossible");
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <h1 className="text-lg font-semibold leading-tight" style={{ fontFamily: "var(--font-display)", color: "var(--g-text)" }}>
          Finances
        </h1>
        <button
          type="button"
          onClick={exporterPdf}
          disabled={!data}
          className="inline-flex items-center gap-1.5 min-h-[44px] px-3.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
          style={{ background: "var(--g-primary)" }}
        >
          <Download className="w-4 h-4" />
          PDF
        </button>
      </div>
      <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
        {PERIODES_FINANCES.map((p) => {
          const actif = periode === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                if (p.id === periode) return;
                setPeriode(p.id);
              }}
              className="shrink-0 min-h-[44px] px-4 rounded-full text-sm font-semibold"
              style={{
                background: actif ? "var(--g-primary)" : "var(--g-surface-2)",
                color: actif ? "#fff" : "var(--g-muted)",
              }}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      <CommissionDueCard
        key={detteRefreshKey}
        enabled={featureEnabled(features, "dette_commission", true)}
      />

      {portefeuille?.payout_mode === "auto" && (portefeuille.message_lisible || Number(portefeuille.solde_en_fenetre) > 0) ? (
        <section className="rounded-2xl p-4 space-y-1" style={{ background: "var(--g-surface)", boxShadow: "var(--g-shadow)" }}>
          <h2 className="text-sm font-semibold" style={{ color: "var(--g-text)" }}>Reversement automatique</h2>
          <p className="text-[12px]" style={{ color: "var(--g-muted)" }}>
            {portefeuille.message_lisible
              || (Number(portefeuille.solde_en_fenetre) > 0
                ? `Encore en fenêtre de remboursement (${fcfa(portefeuille.solde_en_fenetre)}).`
                : "Les dûs sont versés automatiquement après la fenêtre de remboursement.")}
          </p>
        </section>
      ) : null}

      {portefeuille?.payout_mode === "retrait" ? (
        <section className="rounded-2xl p-4 space-y-2" style={{ background: "var(--g-surface)", boxShadow: "var(--g-shadow)" }}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold" style={{ color: "var(--g-text)" }}>Solde à retirer</h2>
              <p className="text-lg font-bold" style={{ color: "var(--g-primary)", fontFamily: "var(--font-display)" }}>
                {fcfa(portefeuille.solde_net_apres_dette || portefeuille.solde_disponible)}
              </p>
            </div>
            <button
              type="button"
              disabled={!portefeuille.bouton_retirer || retraitPending}
              onClick={() => void demanderRetrait()}
              className="min-h-[44px] px-4 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
              style={{ background: "var(--g-primary)" }}
            >
              {retraitPending ? "Demande en cours…" : portefeuille.solde_demande_retrait ? "Retrait en cours" : "Retirer"}
            </button>
          </div>
          <p className="text-[12px]" style={{ color: "var(--g-muted)" }}>
            {portefeuille.solde_demande_retrait
              ? "Une demande est déjà en cours de traitement."
              : portefeuille.bouton_retirer
                ? "Le montant est envoyé à l’équipe pour validation et versement."
                : (portefeuille.message_lisible
                  || "Le retrait devient disponible après validation du canal Wave ou Orange Money et des revenus.")}
          </p>
        </section>
      ) : null}

      {loading ? (
        <FinancesSkeleton />
      ) : error ? (
        <p className="text-sm py-8 text-center" style={{ color: "var(--g-danger)" }}>
          {error}
        </p>
      ) : data ? (
        <FinancesView data={data} />
      ) : null}
    </div>
  );
}
