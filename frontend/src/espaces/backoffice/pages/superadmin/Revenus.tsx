import { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts";
import { superAdminApi } from "@/services/superAdminApi";

const PERIODS = [
  { value: "semaine", label: "Cette semaine" },
  { value: "mois", label: "Ce mois" },
] as const;

export default function Revenus() {
  const [periode, setPeriode] = useState("mois");
  const [data, setData] = useState<any>();

  useEffect(() => {
    superAdminApi.revenus(periode).then(setData).catch(console.error);
  }, [periode]);

  const chartData =
    data?.terrains?.map((t: any) => ({
      name: (t.nom || "").slice(0, 12),
      revenue: Number(t.revenu || 0),
    })) || [];

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
            Aucune donnée
          </div>
        )}
      </div>

      {/* Mobile cards */}
      <div className="flex flex-col gap-2 md:hidden">
        {(data?.terrains || []).map((t: any) => (
          <article
            key={t.id}
            className="bg-white rounded-[var(--radius-md)] border border-[var(--color-border)] p-4 shadow-sm"
          >
            <p className="font-semibold text-sm" style={{ fontFamily: "var(--font-display)" }}>
              {t.nom}
            </p>
            <div className="flex items-center justify-between mt-2 text-xs text-[var(--color-text-secondary)]">
              <span>{t.reservations} réservations</span>
              <span
                className="font-semibold text-[var(--color-primary)]"
                style={{ fontFamily: "var(--font-display)" }}
              >
                {Number(t.revenu).toLocaleString()} CFA
              </span>
            </div>
            <p className="text-[11px] text-[var(--color-text-muted)] mt-1">
              Commission plateforme : —
            </p>
          </article>
        ))}
      </div>

      {/* Desktop table */}
      <div className="hidden md:block bg-white rounded-[var(--radius-lg)] shadow-sm border border-[var(--color-border)] overflow-x-auto">
        <table className="bo-table">
          <thead>
            <tr>
              <th>Terrain</th>
              <th>Réservations</th>
              <th>Revenus</th>
              <th>Commission plateforme</th>
            </tr>
          </thead>
          <tbody>
            {(data?.terrains || []).map((t: any) => (
              <tr key={t.id}>
                <td className="font-medium">{t.nom}</td>
                <td>{t.reservations}</td>
                <td className="font-semibold text-[var(--color-primary)]">
                  {Number(t.revenu).toLocaleString()} CFA
                </td>
                <td className="text-[var(--color-text-muted)]">—</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
