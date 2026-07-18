import { useNavigate } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { proprietaireApi } from "@/lib/api";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts";

const periodOptions = [
  { value: "semaine", label: "Cette semaine" },
  { value: "mois", label: "Ce mois" },
  { value: "annee", label: "Cette annee" },
] as const;

const OwnerReports = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<any>(null);
  const [revenus, setRevenus] = useState<any>(null);
  const [reservations, setReservations] = useState<any[]>([]);
  const [period, setPeriod] = useState<(typeof periodOptions)[number]["value"]>("semaine");

  useEffect(() => {
    loadData();
  }, [period]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [statsData, revenusData, resa] = await Promise.all([
        proprietaireApi.stats(),
        proprietaireApi.revenus(period),
        proprietaireApi.reservations().catch(() => []),
      ]);
      setStats(statsData);
      setRevenus(revenusData);
      setReservations(Array.isArray(resa) ? resa : []);
    } catch (err: any) {
      toast.error(err.message || "Erreur lors du chargement");
    } finally {
      setLoading(false);
    }
  };

  const chartData = useMemo(() => {
    if (period === "annee") {
      return (revenus?.terrains || []).map((t: any) => ({
        day: (t.nom || "").slice(0, 10),
        revenue: Number(t.avances_encaissees || 0),
      }));
    }
    return stats?.weeklyRevenue || [];
  }, [stats, revenus, period]);

  const transactions = useMemo(() => {
    const now = new Date();
    return reservations
      .filter((r) => {
        if (!r.date) return true;
        const d = new Date(r.date);
        if (period === "semaine") {
          const start = new Date(now);
          start.setDate(now.getDate() - 7);
          return d >= start;
        }
        if (period === "mois") {
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
          Avances encaissees :{" "}
          <span
            className="font-semibold text-[var(--color-accent)]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {Number(revenus?.avances_encaissees || 0).toLocaleString()} CFA
          </span>
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <article className="bg-white rounded-[var(--radius-md)] border border-[var(--color-border)] p-4 shadow-sm">
          <p className="text-xs text-[var(--color-text-secondary)]">Acomptes recus ce mois</p>
          <p className="mt-2 text-xl font-semibold text-[var(--color-accent)]">
            {Number(revenus?.avances_encaissees || 0).toLocaleString()} CFA
          </p>
        </article>
        <article className="bg-white rounded-[var(--radius-md)] border border-[var(--color-border)] p-4 shadow-sm">
          <p className="text-xs text-[var(--color-text-secondary)]">Revenus matchs joues ce mois</p>
          <p className="mt-2 text-xl font-semibold text-[var(--color-primary)]">
            {Number(revenus?.montants_reverses || 0).toLocaleString()} CFA
          </p>
        </article>
        <article className="bg-white rounded-[var(--radius-md)] border border-[var(--color-border)] p-4 shadow-sm">
          <p className="text-xs text-[var(--color-text-secondary)]">Matchs joues ce mois</p>
          <p className="mt-2 text-xl font-semibold text-[var(--color-text-primary)]">
            {Number(revenus?.reservations || 0).toLocaleString()}
          </p>
        </article>
        <article className="bg-white rounded-[var(--radius-md)] border border-[var(--color-border)] p-4 shadow-sm">
          <p className="text-xs text-[var(--color-text-secondary)]">Matchs en attente</p>
          <p className="mt-2 text-xl font-semibold text-[var(--color-text-primary)]">
            {Number(stats?.pendingReservations || 0).toLocaleString()}
          </p>
        </article>
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
              <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#9CA3AF" }} axisLine={false} tickLine={false} />
              <YAxis hide />
              <Tooltip
                formatter={(value: number) => [`${Number(value).toLocaleString()} CFA`, "Montant"]}
                contentStyle={{ borderRadius: 12, fontSize: 12, border: "1px solid var(--color-border)" }}
              />
              <Bar dataKey="revenue" fill="#0A5C36" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-[220px] flex items-center justify-center text-[var(--color-text-muted)] text-sm">
            Aucune donnee disponible
          </div>
        )}
      </div>

      <section>
        <h2 className="section-title mb-3">Par terrain</h2>
        <div className="hidden md:block bg-white rounded-[var(--radius-lg)] shadow-sm border border-[var(--color-border)] overflow-x-auto">
          <table className="bo-table">
            <thead>
              <tr>
                <th>Terrain</th>
                <th>Reservations</th>
                <th>Acomptes recus</th>
                <th>Montant recu</th>
              </tr>
            </thead>
            <tbody>
              {(revenus?.terrains || []).map((t: any) => (
                <tr key={t.id}>
                  <td className="font-medium">{t.nom}</td>
                  <td>{Number(t.reservations || 0).toLocaleString()}</td>
                  <td>{Number(t.avances_encaissees || 0).toLocaleString()} CFA</td>
                  <td>{Number(t.montants_reverses || 0).toLocaleString()} CFA</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-col gap-2 md:hidden">
          {(revenus?.terrains || []).map((t: any) => (
            <article key={t.id} className="bg-white rounded-[var(--radius-md)] border border-[var(--color-border)] p-4 shadow-sm">
              <p className="font-semibold text-sm" style={{ fontFamily: "var(--font-display)" }}>{t.nom}</p>
              <p className="text-xs text-[var(--color-text-muted)] mt-2">
                Montant recu {Number(t.montants_reverses || 0).toLocaleString()} CFA
              </p>
            </article>
          ))}
        </div>
      </section>

      <section>
        <h2 className="section-title mb-3">Reservations</h2>
        <div className="hidden md:block bg-white rounded-[var(--radius-lg)] shadow-sm border border-[var(--color-border)] overflow-x-auto">
          <table className="bo-table">
            <thead>
              <tr>
                <th>Terrain</th>
                <th>Date</th>
                <th>Statut</th>
                <th>Montant recu</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((r) => (
                <tr key={r.id}>
                  <td className="font-medium">{r.terrain_nom || "Terrain"}</td>
                  <td>{r.date}</td>
                  <td>{r.statut === "joue" ? "Joue" : "Confirme"}</td>
                  <td>{Number(r.montant_avance || r.acompte || r.montant || r.prix_total || 0).toLocaleString()} CFA</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-col gap-2 md:hidden">
          {transactions.map((r) => (
            <div key={r.id} className="bg-white rounded-[var(--radius-md)] border border-[var(--color-border)] p-4 flex items-center justify-between gap-3 shadow-sm">
              <div className="min-w-0">
                <p className="font-semibold text-sm truncate" style={{ fontFamily: "var(--font-display)" }}>{r.terrain_nom || "Terrain"}</p>
                <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{r.date} - {r.statut === "joue" ? "Joue" : "Confirme"}</p>
              </div>
              <span className="text-sm font-semibold text-[var(--color-primary)] whitespace-nowrap" style={{ fontFamily: "var(--font-display)" }}>
                {Number(r.montant_avance || r.acompte || r.montant || r.prix_total || 0).toLocaleString()} CFA
              </span>
            </div>
          ))}
          {transactions.length === 0 && (
            <p className="text-sm text-[var(--color-text-muted)] text-center py-8">
              Aucune transaction sur cette periode
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
