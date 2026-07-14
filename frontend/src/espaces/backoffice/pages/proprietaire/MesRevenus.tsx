import { useNavigate } from "react-router-dom";
import { useState, useEffect, useMemo } from "react";
import { toast } from "sonner";
import { proprietaireApi } from "@/lib/api";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts";

const periodOptions = [
  { value: "week", label: "Cette semaine" },
  { value: "month", label: "Ce mois" },
  { value: "year", label: "Cette année" },
] as const;

const OwnerReports = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<any>(null);
  const [reservations, setReservations] = useState<any[]>([]);
  const [period, setPeriod] = useState<(typeof periodOptions)[number]["value"]>("week");

  useEffect(() => {
    loadData();
  }, [period]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [data, resa] = await Promise.all([
        proprietaireApi.stats(),
        proprietaireApi.reservations().catch(() => []),
      ]);
      setStats(data);
      setReservations(Array.isArray(resa) ? resa : []);
    } catch (err: any) {
      toast.error(err.message || "Erreur lors du chargement");
    } finally {
      setLoading(false);
    }
  };

  const chartData = useMemo(() => {
    if (period === "year") {
      return (stats?.terrainStats || []).map((t: any) => ({
        day: (t.nom || "").slice(0, 10),
        revenue: t.revenue || 0,
      }));
    }
    // week & month : graphique barres existant (7 jours)
    return stats?.weeklyRevenue || [];
  }, [stats, period]);

  const transactions = useMemo(() => {
    const now = new Date();
    return reservations
      .filter((r) => {
        if (!r.date) return true;
        const d = new Date(r.date);
        if (period === "week") {
          const start = new Date(now);
          start.setDate(now.getDate() - 7);
          return d >= start;
        }
        if (period === "month") {
          return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
        }
        return d.getFullYear() === now.getFullYear();
      })
      .slice(0, 20);
  }, [reservations, period]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-pulse text-[var(--color-text-secondary)] text-sm">Chargement...</div>
      </div>
    );
  }

  const totalRevenue = stats?.totalRevenue || 0;

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <h1
          className="text-xl font-semibold text-[var(--color-text-primary)]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Mes revenus
        </h1>
        <p className="text-sm text-[var(--color-text-secondary)] mt-1">
          Total :{" "}
          <span
            className="font-semibold text-[var(--color-accent)]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {totalRevenue.toLocaleString()} CFA
          </span>
        </p>
      </div>

      <div className="flex gap-2 overflow-x-auto scrollbar-hide">
        {periodOptions.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => setPeriod(opt.value)}
            className={`px-4 min-h-[40px] rounded-full text-sm font-medium flex-shrink-0 transition-colors ${
              period === opt.value
                ? "bg-[var(--color-primary)] text-white"
                : "bg-white border border-[var(--color-border)] text-[var(--color-text-secondary)]"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-[var(--radius-lg)] border border-[var(--color-border)] p-4 shadow-sm">
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData}>
              <XAxis
                dataKey="day"
                tick={{ fontSize: 11, fill: "#9CA3AF" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis hide />
              <Tooltip
                formatter={(value: number) => [`${Number(value).toLocaleString()} CFA`, "Revenu"]}
                contentStyle={{
                  borderRadius: 12,
                  fontSize: 12,
                  border: "1px solid var(--color-border)",
                }}
              />
              <Bar dataKey="revenue" fill="#0A5C36" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-[220px] flex items-center justify-center text-[var(--color-text-muted)] text-sm">
            Aucune donnée disponible
          </div>
        )}
      </div>

      <section>
        <h2 className="section-title mb-3">Dernières transactions</h2>
        <div className="flex flex-col gap-2">
          {transactions.map((r) => (
            <div
              key={r.id}
              className="bg-white rounded-[var(--radius-md)] border border-[var(--color-border)] p-4 flex items-center justify-between gap-3 shadow-sm"
            >
              <div className="min-w-0">
                <p
                  className="font-semibold text-sm truncate"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  {r.terrain_nom || "Terrain"}
                </p>
                <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                  {r.date}
                  {r.joueur_nom ? ` · ${r.joueur_nom}` : ""}
                </p>
              </div>
              <span
                className="text-sm font-semibold text-[var(--color-primary)] whitespace-nowrap"
                style={{ fontFamily: "var(--font-display)" }}
              >
                {(r.montant || r.prix_total || 0).toLocaleString()} CFA
              </span>
            </div>
          ))}
          {transactions.length === 0 && (
            <p className="text-sm text-[var(--color-text-muted)] text-center py-8">
              Aucune transaction sur cette période
            </p>
          )}
        </div>
      </section>

      <button
        type="button"
        onClick={() => navigate("/backoffice/proprietaire")}
        className="w-full min-h-[48px] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-white text-sm font-medium md:hidden"
      >
        Retour au dashboard
      </button>
    </div>
  );
};

export default OwnerReports;
