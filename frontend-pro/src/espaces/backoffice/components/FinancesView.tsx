import { Banknote, CalendarCheck, CalendarClock, Wallet } from "lucide-react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export type PeriodeFinances = "aujourd_hui" | "semaine" | "mois" | "annee";

export type LigneEncaissement = {
  id: number | string;
  date: string;
  heure_debut: string;
  joueur_nom: string;
  montant_avance: number;
  source?: string;
  terrain_nom?: string | null;
};

export type FinancesData = {
  periode: PeriodeFinances;
  from: string;
  to: string;
  total_encaisse: number;
  encaisse_reservations?: number;
  encaisse_abonnements?: number;
  encaisse_tournois?: number;
  encaisse_blocages?: number;
  mention_blocages?: string;
  avances_recues: number;
  matchs_joues: number;
  a_venir: number;
  historique: LigneEncaissement[];
  graphique: Array<{ label: string; montant: number }>;
};

export const PERIODES_FINANCES: Array<{ id: PeriodeFinances; label: string }> = [
  { id: "aujourd_hui", label: "Aujourd'hui" },
  { id: "semaine", label: "Cette semaine" },
  { id: "mois", label: "Ce mois" },
  { id: "annee", label: "Cette année" },
];

export function formatFcfa(value?: number) {
  return `${Number(value || 0).toLocaleString("fr-FR")} FCFA`;
}

function formatLigneDate(date?: string, heure?: string) {
  if (!date) return "—";
  const d = new Date(`${date}T12:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  const jour = d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
  const h = String(heure || "").slice(0, 5);
  return h ? `${jour} · ${h}` : jour;
}

export function FinancesSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="grid grid-cols-2 gap-2.5">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-24 rounded-2xl" style={{ background: "var(--g-surface-2)" }} />
        ))}
      </div>
      <div className="h-52 rounded-2xl" style={{ background: "var(--g-surface-2)" }} />
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-16 rounded-xl" style={{ background: "var(--g-surface-2)" }} />
        ))}
      </div>
    </div>
  );
}

export default function FinancesView({
  data,
  showTerrainName = false,
}: {
  data: FinancesData;
  showTerrainName?: boolean;
}) {
  const kpis = [
    {
      label: "Montant total encaissé",
      value: formatFcfa(data.total_encaisse),
      icon: Wallet,
      accent: true,
    },
    {
      label: "Avances reçues",
      value: formatFcfa(data.avances_recues),
      icon: Banknote,
      accent: false,
    },
    {
      label: "Matchs joués",
      value: String(data.matchs_joues ?? 0),
      icon: CalendarCheck,
      accent: false,
    },
    {
      label: "À venir",
      value: String(data.a_venir ?? 0),
      icon: CalendarClock,
      accent: false,
    },
  ];

  const historique = data.historique || [];
  const graphique = data.graphique || [];
  const hasChart = graphique.some((p) => Number(p.montant) > 0);

  return (
    <>
      <div className="grid grid-cols-2 gap-2.5">
        {kpis.map((kpi) => (
          <div
            key={kpi.label}
            className="rounded-2xl p-4"
            style={{ background: "var(--g-surface)", boxShadow: "var(--g-shadow)" }}
          >
            <kpi.icon
              className="w-4 h-4 mb-2"
              style={{ color: kpi.accent ? "var(--g-primary)" : "var(--g-muted)" }}
            />
            <p
              className="text-lg font-bold leading-tight"
              style={{
                fontFamily: "var(--font-display)",
                color: kpi.accent ? "var(--g-primary)" : "var(--g-text)",
              }}
            >
              {kpi.value}
            </p>
            <p className="text-[11px] mt-1" style={{ color: "var(--g-muted)" }}>
              {kpi.label}
            </p>
          </div>
        ))}
      </div>

      {data.mention_blocages ? (
        <div
          className="rounded-xl px-3 py-2.5 text-xs leading-relaxed"
          style={{
            background: Number(data.encaisse_blocages) > 0 ? "var(--g-libre-bg)" : "var(--g-surface-2)",
            color: "var(--g-text-2)",
          }}
        >
          {data.mention_blocages}
          {Number(data.encaisse_blocages) > 0 ? (
            <span className="block mt-1" style={{ color: "var(--g-muted)" }}>
              Matchs {formatFcfa(data.encaisse_reservations)} · Abonnements{" "}
              {formatFcfa(data.encaisse_abonnements)} · Tournois {formatFcfa(data.encaisse_tournois)}
            </span>
          ) : null}
        </div>
      ) : null}

      <section
        className="rounded-2xl p-3"
        style={{ background: "var(--g-surface)", boxShadow: "var(--g-shadow)" }}
      >
        <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--g-text)" }}>
          Encaissements
        </h2>
        {hasChart ? (
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={graphique} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: "var(--g-muted)" }}
                  axisLine={false}
                  tickLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis hide />
                <Tooltip
                  formatter={(value: number, _name, item) => {
                    const matchs = Number((item?.payload as { matchs?: number } | undefined)?.matchs || 0);
                    const extra = matchs ? ` · ${matchs} match${matchs > 1 ? "s" : ""}` : "";
                    return [`${formatFcfa(Number(value || 0))}${extra}`, "Encaissé"];
                  }}
                  contentStyle={{
                    borderRadius: 12,
                    fontSize: 12,
                    border: "1px solid var(--g-border)",
                    background: "var(--g-surface)",
                    color: "var(--g-text)",
                  }}
                />
                <Bar dataKey="montant" fill="#1E40AF" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="text-sm text-center py-10" style={{ color: "var(--g-muted)" }}>
            Aucun encaissement sur cette période
          </p>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--g-text)" }}>
          Historique des encaissements
        </h2>
        {historique.length === 0 ? (
          <p
            className="text-sm text-center py-8 rounded-xl"
            style={{ color: "var(--g-muted)", background: "var(--g-surface)" }}
          >
            Aucun encaissement sur cette période
          </p>
        ) : (
          <ul className="space-y-2">
            {historique.map((item) => (
              <li
                key={item.id}
                className="rounded-xl p-3 flex items-center justify-between gap-3"
                style={{ background: "var(--g-surface)", boxShadow: "var(--g-shadow)" }}
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate" style={{ color: "var(--g-text)" }}>
                    {item.joueur_nom}
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: "var(--g-muted)" }}>
                    {formatLigneDate(item.date, item.heure_debut)}
                    {showTerrainName && item.terrain_nom ? ` · ${item.terrain_nom}` : ""}
                  </p>
                </div>
                <p className="text-sm font-bold shrink-0" style={{ color: "var(--g-primary)" }}>
                  {formatFcfa(item.montant_avance)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
