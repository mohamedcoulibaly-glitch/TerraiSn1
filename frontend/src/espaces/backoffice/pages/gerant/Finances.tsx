import { useCallback, useEffect, useRef, useState } from "react";
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

export default function FinancesPage() {
  const { user } = useAuth();
  const [periode, setPeriode] = useState<PeriodeFinances>("aujourd_hui");
  const [data, setData] = useState<FinancesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [features, setFeatures] = useState<Record<string, boolean> | null>(null);
  const refreshTimer = useRef<number | null>(null);

  const load = useCallback((quiet = false) => {
    if (!quiet) {
      setLoading(true);
      setData(null);
    }
    setError("");
    gerantApi
      .finances(periode)
      .then((payload) => setData(payload as FinancesData))
      .catch((err) => {
        setData(null);
        setError(err instanceof Error ? err.message : "Impossible de charger les finances");
      })
      .finally(() => setLoading(false));
  }, [periode]);

  useEffect(() => {
    load();
  }, [load]);

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

  return (
    <div className="space-y-5">
      <h1 className="text-lg font-semibold leading-tight" style={{ fontFamily: "var(--font-display)", color: "var(--g-text)" }}>
        Finances
      </h1>
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

      <CommissionDueCard enabled={featureEnabled(features, "dette_commission", true)} />

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
