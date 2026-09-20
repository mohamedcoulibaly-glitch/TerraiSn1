import { useEffect, useState } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import SaPageHeader from "@/espaces/backoffice/components/superadmin/ui/SaPageHeader";
import { superAdminApi } from "@/services/superAdminApi";
import { useSaCrumbs } from "@/espaces/backoffice/layout/SuperadminLayout";
import { fcfa } from "@/lib/saContrat";
import Select2 from "@/components/Select2";

export default function Revenus() {
  useSaCrumbs([{ label: "Revenus TerrainSN" }]);
  const [terrainId, setTerrainId] = useState("tous");
  const [data, setData] = useState<any>();
  const [terrainsList, setTerrainsList] = useState<any[]>([]);

  useEffect(() => {
    superAdminApi.revenusPaiements().then(setData).catch(console.error);
    superAdminApi.terrains().then((t) => setTerrainsList(Array.isArray(t) ? t : [])).catch(console.error);
  }, []);

  const allRows = (data?.terrains || []).map((t: any) => ({
    id: t.id,
    nom: t.nom,
    pctCom: Number((terrainsList.find((x) => Number(x.id) === Number(t.id)) || {}).commission_pourcentage || 0),
    commission: Number(t.commission_acquise || 0),
    frais: Number(t.frais_absorbes || 0),
    net: Number(t.commission_acquise || 0) - Number(t.frais_absorbes || 0),
  }));
  const table = allRows.filter((t: any) => terrainId === "tous" || String(t.id) === terrainId);
  const commissionMois = table.reduce((s: number, r: any) => s + r.commission, 0);
  const fraisAbsorbes = table.reduce((s: number, r: any) => s + r.frais, 0);
  const net = commissionMois - fraisAbsorbes;
  const chartData = table.map((t: any) => ({
    name: (t.nom || "").slice(0, 12),
    commission: t.commission,
    frais: t.frais,
  }));

  return (
    <div className="space-y-5 max-w-[1200px]">
      <SaPageHeader
        titre="Revenus TerrainSN"
        sousTitre="Commission sur l’avance uniquement — pas les 35 000 F sur place, ni l’argent du gérant."
        actions={
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
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        {[
          { label: "Commission acquise", value: fcfa(commissionMois), color: "var(--sa-success)" },
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
              <th>Commission</th>
              <th>Frais absorbés</th>
              <th>Net</th>
            </tr>
          </thead>
          <tbody>
            {table.map((t: any) => (
              <tr key={t.id}>
                <td className="font-medium">{t.nom}</td>
                <td>{t.pctCom}%</td>
                <td>{fcfa(t.commission)}</td>
                <td>{fcfa(t.frais)}</td>
                <td className="font-semibold">{fcfa(t.net)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
