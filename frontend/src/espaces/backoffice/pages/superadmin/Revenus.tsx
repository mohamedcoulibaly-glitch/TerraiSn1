import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import SaPageHeader from "@/espaces/backoffice/components/superadmin/ui/SaPageHeader";
import { superAdminApi } from "@/services/superAdminApi";
import { useSaCrumbs } from "@/espaces/backoffice/layout/SuperadminLayout";
import { fcfa, getContratOverlay } from "@/lib/saContrat";
import Select2 from "@/components/Select2";

const PERIODS = [
  { value: "semaine", label: "Cette semaine" },
  { value: "mois", label: "Ce mois" },
  { value: "annee", label: "Cette année" },
] as const;

export default function Revenus() {
  useSaCrumbs([{ label: "Revenus TerrainSN" }]);
  const [periode, setPeriode] = useState("mois");
  const [terrainId, setTerrainId] = useState("tous");
  const [data, setData] = useState<any>();
  const [finances, setFinances] = useState<any>();

  useEffect(() => {
    superAdminApi.revenus(periode).then(setData).catch(console.error);
  }, [periode]);

  useEffect(() => {
    superAdminApi.finances().then(setFinances).catch(console.error);
  }, []);

  const rows = useMemo(() => {
    const list = (finances?.terrains || []).filter((t: any) => terrainId === "tous" || String(t.id) === terrainId);
    return list.map((t: any) => {
      const c = getContratOverlay(t.id);
      const commission = Number(t.commissions || 0);
      const avances = Number(t.avances || t.acomptes || 0);
      const frais = 0;
      return {
        id: t.id,
        nom: t.nom,
        pct: Number((data?.terrains || []).find((x: any) => x.id === t.id)?.commission_pourcentage) || c.frais_payout_pct_plateforme,
        pctCom: undefined as number | undefined,
        avances,
        commission,
        frais,
        net: commission - frais,
      };
    });
  }, [finances, terrainId, data]);

  const terrainsApi = data?.terrains || [];
  const merged = rows.map((r) => {
    const api = terrainsApi.find((t: any) => Number(t.id) === Number(r.id));
    return { ...r, pctCom: Number(api ? undefined : undefined) };
  });

  const [terrainsList, setTerrainsList] = useState<any[]>([]);
  useEffect(() => {
    superAdminApi.terrains().then((t) => setTerrainsList(Array.isArray(t) ? t : [])).catch(console.error);
  }, []);

  const table = merged.map((r) => {
    const t = terrainsList.find((x) => Number(x.id) === Number(r.id));
    return { ...r, pctCom: Number(t?.commission_pourcentage || 0) };
  });

  const commissionMois = table.reduce((s, r) => s + r.commission, 0);
  const fenetre = 0;
  const fraisAbsorbes = table.reduce((s, r) => s + r.frais, 0);
  const net = commissionMois - fraisAbsorbes;

  const chartData = table.map((t) => ({
    name: (t.nom || "").slice(0, 12),
    commission: t.commission,
    frais: -t.frais,
  }));

  return (
    <div className="space-y-5 max-w-[1200px]">
      <SaPageHeader
        titre="Revenus TerrainSN"
        actions={
          <div className="flex flex-wrap gap-2">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => setPeriode(p.value)}
              className="h-9 px-3 rounded-full text-[12px] font-semibold"
              style={{
                background: periode === p.value ? "var(--sa-primary)" : "var(--sa-surface)",
                color: periode === p.value ? "var(--sa-surface)" : "var(--sa-text-2)",
                border: "1px solid var(--sa-border)",
              }}
            >
              {p.label}
            </button>
          ))}
          <Select2
            size="sm"
            className="!w-[200px] min-w-[180px]"
            value={terrainId}
            onChange={setTerrainId}
            options={[
              { value: "tous", label: "Tous les terrains" },
              ...terrainsList.map((t) => ({ value: String(t.id), label: t.nom })),
            ]}
          />
          </div>
        }
      />

      <p className="text-[12px]" style={{ color: "var(--sa-muted)" }}>
        Revenus de TerrainSN (commission + frais absorbés) — pas les revenus propriétaires ni gérants.
      </p>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: "Commission acquise ce mois", value: fcfa(commissionMois), color: "var(--sa-success)" },
          { label: "Commission encore en fenêtre", value: fcfa(fenetre), color: "var(--sa-warning)" },
          { label: "Frais payout absorbés", value: fcfa(fraisAbsorbes), color: "var(--sa-warning)" },
          { label: "Revenu net", value: fcfa(net), color: "var(--sa-primary)" },
        ].map((k) => (
          <article key={k.label} className="rounded-xl p-4" style={{ background: "var(--sa-surface)", boxShadow: "var(--sa-shadow)" }}>
            <p className="text-[11px]" style={{ color: "var(--sa-muted)" }}>{k.label}</p>
            <p className="mt-2 text-[20px] font-semibold" style={{ color: k.color, fontFamily: "var(--font-display)" }}>{k.value}</p>
          </article>
        ))}
      </div>

      <div className="rounded-xl p-4" style={{ background: "var(--sa-surface)", boxShadow: "var(--sa-shadow)" }}>
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={chartData}>
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: "var(--sa-muted)" }} axisLine={false} tickLine={false} />
              <YAxis hide />
              <Tooltip
                formatter={(value: number, name: string) => [`${Number(value).toLocaleString("fr-FR")} FCFA`, name === "frais" ? "Frais absorbés" : "Commission"]}
                contentStyle={{ borderRadius: 12, fontSize: 12, border: "1px solid var(--sa-border)", background: "var(--sa-surface)" }}
              />
              <Bar dataKey="commission" fill="var(--sa-primary)" radius={[8, 8, 0, 0]} />
              <Bar dataKey="frais" fill="var(--sa-warning)" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-[240px] grid place-items-center text-sm" style={{ color: "var(--sa-muted)" }}>Aucune donnée</div>
        )}
      </div>

      <div className="hidden md:block rounded-xl overflow-hidden" style={{ background: "var(--sa-surface)", boxShadow: "var(--sa-shadow)" }}>
        <table className="sa-table">
          <thead>
            <tr>
              <th>Terrain</th>
              <th>% com</th>
              <th>Avances traitées</th>
              <th>Commission</th>
              <th>Frais absorbés</th>
              <th>Net</th>
            </tr>
          </thead>
          <tbody>
            {table.map((t) => (
              <tr key={t.id}>
                <td className="font-medium">{t.nom}</td>
                <td>{t.pctCom}%</td>
                <td>{fcfa(t.avances)}</td>
                <td>{fcfa(t.commission)}</td>
                <td>{fcfa(t.frais)}</td>
                <td className="font-semibold">{fcfa(t.net)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="md:hidden space-y-2">
        {table.map((t) => (
          <article key={t.id} className="rounded-xl p-4" style={{ background: "var(--sa-surface)", boxShadow: "var(--sa-shadow)" }}>
            <p className="font-semibold text-[13px]">{t.nom}</p>
            <p className="text-[12px] mt-1" style={{ color: "var(--sa-muted)" }}>Com. {fcfa(t.commission)} · Net {fcfa(t.net)}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
