import { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts";
import { superAdminApi } from "@/services/superAdminApi";

const PERIODS = [
  { value: "semaine", label: "Cette semaine" },
  { value: "mois", label: "Ce mois" },
  { value: "annee", label: "Cette annee" },
] as const;

export default function Revenus() {
  const [periode, setPeriode] = useState("mois");
  const [data, setData] = useState<any>();
  const [finances, setFinances] = useState<any>();

  useEffect(() => {
    superAdminApi.revenus(periode).then(setData).catch(console.error);
  }, [periode]);

  useEffect(() => {
    superAdminApi.finances().then(setFinances).catch(console.error);
  }, []);

  const chartData =
    data?.terrains?.map((t: any) => ({
      name: (t.nom || "").slice(0, 12),
      revenue: Number(t.revenu || 0),
    })) || [];

  const financialRows = finances?.terrains || [];

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h2
          className="text-xl font-semibold text-[var(--color-text-primary)]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Revenus globaux
        </h2>
        <p className="text-sm text-[var(--color-text-secondary)] mt-1">
          Total :{" "}
          <span
            className="font-semibold text-[var(--color-accent)]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {Number(data?.total || 0).toLocaleString()} CFA
          </span>
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <article className="bg-white rounded-[var(--radius-md)] border border-[var(--color-border)] p-4 shadow-sm">
          <p className="text-xs text-[var(--color-text-secondary)]">Avances encaissees</p>
          <p className="mt-2 text-xl font-semibold text-[var(--color-primary)]">
            {Number(finances?.total_avances || 0).toLocaleString()} CFA
          </p>
        </article>
        <article className="bg-white rounded-[var(--radius-md)] border border-[var(--color-border)] p-4 shadow-sm">
          <p className="text-xs text-[var(--color-text-secondary)]">Commission plateforme</p>
          <p className="mt-2 text-xl font-semibold text-[var(--color-accent)]">
            {Number(finances?.total_commissions || 0).toLocaleString()} CFA
          </p>
        </article>
        <article className="bg-white rounded-[var(--radius-md)] border border-[var(--color-border)] p-4 shadow-sm">
          <p className="text-xs text-[var(--color-text-secondary)]">Reverse aux gerants</p>
          <p className="mt-2 text-xl font-semibold text-[var(--color-text-primary)]">
            {Number(finances?.total_reverse || 0).toLocaleString()} CFA
          </p>
        </article>
      </div>

      <div className="flex gap-2 overflow-x-auto scrollbar-hide">
        {PERIODS.map((p) => (
          <button
            key={p.value}
            type="button"
            onClick={() => setPeriode(p.value)}
            className={`px-4 min-h-[40px] rounded-full text-sm font-medium flex-shrink-0 ${
              periode === p.value
                ? "bg-[var(--color-primary)] text-white"
                : "bg-white border border-[var(--color-border)] text-[var(--color-text-secondary)]"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-[var(--radius-lg)] border border-[var(--color-border)] p-4 shadow-sm">
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={chartData}>
              <XAxis
                dataKey="name"
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
          <div className="h-[240px] flex items-center justify-center text-sm text-[var(--color-text-muted)]">
            Aucune donnee
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2 md:hidden">
        {financialRows.map((t: any) => (
          <article
            key={t.id}
            className="bg-white rounded-[var(--radius-md)] border border-[var(--color-border)] p-4 shadow-sm"
          >
            <p className="font-semibold text-sm" style={{ fontFamily: "var(--font-display)" }}>
              {t.nom}
            </p>
            <div className="grid grid-cols-3 gap-2 mt-3 text-xs">
              <span>Avances {Number(t.avances || 0).toLocaleString()}</span>
              <span>Com. {Number(t.commissions || 0).toLocaleString()}</span>
              <span>Reverse {Number(t.reverse || 0).toLocaleString()}</span>
            </div>
          </article>
        ))}
      </div>

      <div className="hidden md:block bg-white rounded-[var(--radius-lg)] shadow-sm border border-[var(--color-border)] overflow-x-auto">
        <table className="bo-table">
          <thead>
            <tr>
              <th>Terrain</th>
              <th>Reservations</th>
              <th>Revenus joues</th>
              <th>Avances</th>
              <th>Commission</th>
              <th>Reverse gerant</th>
            </tr>
          </thead>
          <tbody>
            {(data?.terrains || []).map((t: any) => {
              const finance = financialRows.find((row: any) => row.id === t.id) || {};
              return (
                <tr key={t.id}>
                  <td className="font-medium">{t.nom}</td>
                  <td>{t.reservations}</td>
                  <td className="font-semibold text-[var(--color-primary)]">
                    {Number(t.revenu).toLocaleString()} CFA
                  </td>
                  <td>{Number(finance.avances || 0).toLocaleString()} CFA</td>
                  <td>{Number(finance.commissions || 0).toLocaleString()} CFA</td>
                  <td>{Number(finance.reverse || 0).toLocaleString()} CFA</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
