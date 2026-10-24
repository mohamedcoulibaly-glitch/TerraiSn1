import { Activity, CheckCircle, CreditCard, Wallet } from "lucide-react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { KpiMontantWave } from "./KpiMontantWave";

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
  par_terrain?: Array<{
    id?: number;
    nom: string;
    total_encaisse?: number;
    avances_recues?: number;
    matchs_joues?: number;
    a_venir?: number;
    nb_reservations?: number;
  }>;
  solde_disponible?: number;
  solde_a_retirer?: number;
  total_avances?: number;
  total_commission?: number;
  frais_payout_gerant?: number;
  montant_net?: number;
  soldes_encaissees?: number;
  montant_touche?: number;
  net_recu?: number;
  valeur_totale_matchs?: number;
  delta_total_pct?: number | null;
  delta_net_pct?: number | null;
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
      <div className="h-36 rounded-2xl" style={{ background: "var(--g-surface-2)" }} />
      <div className="grid grid-cols-2 gap-2.5">
        {[1, 2].map((i) => (
          <div key={i} className="h-28 rounded-2xl" style={{ background: "var(--g-surface-2)" }} />
        ))}
      </div>
      <div className="h-52 rounded-2xl" style={{ background: "var(--g-surface-2)" }} />
    </div>
  );
}

export default function FinancesView({
  data,
  showTerrainName = false,
  onRetrait,
  peutRetirer = false,
}: {
  data: FinancesData;
  showTerrainName?: boolean;
  onRetrait?: () => void;
  peutRetirer?: boolean;
}) {
  const totalEncaisse = Number(data.total_encaisse || 0);
  const totalAvances = Number(data.total_avances ?? data.avances_recues ?? totalEncaisse);
  const totalCommission = Number(data.total_commission || 0);
  const fraisPayout = Number(data.frais_payout_gerant || 0);
  const soldesEncaissees = Number(data.soldes_encaissees || 0);
  // CA = reste encaissé + avances − commission (− frais)
  const montantTouche = Number(
    data.montant_touche
      ?? Math.max(0, totalAvances + soldesEncaissees - totalCommission - fraisPayout),
  );
  // Solde à retirer = CA − avances en ligne
  const solde = Number(
    data.solde_a_retirer
      ?? Math.max(0, montantTouche - totalAvances),
  );
  const matchsJoues = Number(data.matchs_joues || 0);
  const deltaNet =
    data.delta_net_pct != null
      ? Number(data.delta_net_pct)
      : data.delta_total_pct != null
        ? Number(data.delta_total_pct)
        : undefined;

  const historique = data.historique || [];
  const graphique = data.graphique || [];
  const hasChart = graphique.some((p) => Number(p.montant) > 0);

  const souslabelTouche = [
    `Reste encaissé + avances − commission`,
    fraisPayout > 0 ? ` − frais` : "",
  ].join("");

  return (
    <div className="space-y-3">
      {/* 3 KPI — chiffre d'affaires, avances, matchs (nombre) */}
      <KpiMontantWave
        label="Chiffre d'affaires"
        montant={montantTouche}
        icone={CheckCircle}
        couleur="var(--g-primary)"
        taille="hero"
        delta={deltaNet}
        souslabel={souslabelTouche}
      />

      <div className="grid grid-cols-2 gap-3">
        <KpiMontantWave
          label="Avances joueurs"
          montant={totalAvances}
          icone={CreditCard}
          couleur="var(--g-info)"
          taille="normal"
          souslabel="Payé en ligne"
        />
        <KpiMontantWave
          label="Matchs joués"
          montant={matchsJoues}
          icone={Activity}
          couleur="var(--g-accent)"
          taille="normal"
          format="nombre"
        />
      </div>

      {/* Solde = net touché − avances en ligne */}
      {(solde > 0 || peutRetirer) && (
        <button
          type="button"
          onClick={peutRetirer ? onRetrait : undefined}
          disabled={!peutRetirer}
          className={`w-full flex items-center justify-between gap-3 rounded-xl px-4 py-3 text-left ${peutRetirer ? "btn-press" : ""}`}
          style={{
            background: "var(--g-surface-2)",
            border: "1px solid var(--g-border)",
            cursor: peutRetirer ? "pointer" : "default",
            opacity: peutRetirer ? 1 : 0.85,
          }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <Wallet className="w-4 h-4 shrink-0" style={{ color: "var(--g-primary)" }} />
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--g-muted)" }}>
                Solde à retirer
              </p>
              <p className="text-sm font-bold tabular-nums" style={{ color: "var(--g-text)" }}>
                {formatFcfa(solde)}
              </p>
              <p className="text-[11px] mt-0.5" style={{ color: "var(--g-muted)" }}>
                Chiffre d'affaires − avances en ligne
              </p>
            </div>
          </div>
          {peutRetirer ? (
            <span className="text-xs font-semibold shrink-0" style={{ color: "var(--g-primary)" }}>
              Retirer →
            </span>
          ) : null}
        </button>
      )}

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
    </div>
  );
}
