import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Activity,
  Banknote,
  CalendarCheck,
  CalendarClock,
  CheckCircle,
  CreditCard,
  Download,
  History,
  Info,
  Search,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { Bar, BarChart, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { proprietaireApi } from "@/lib/api";
import { useOwnerRealtime } from "@/hooks/useOwnerRealtime";
import ProprioEmptyState from "@/espaces/backoffice/components/ProprioEmptyState";
import { formaterMontant, KpiMontantWave } from "@/espaces/backoffice/components/KpiMontantWave";
import { formatFcfa, variationHint } from "@/espaces/backoffice/proprietaire/proprioUtils";
import { exportFinancesPdf } from "@/lib/exportFinancesPdf";

const proprioKpiVars = {
  surfaceVar: "var(--p-surface)",
  borderVar: "var(--p-border)",
  textVar: "var(--p-text)",
  mutedVar: "var(--p-muted)",
  shadowVar: "var(--p-shadow)",
  dangerVar: "var(--p-danger)",
} as const;

type Periode = "aujourd_hui" | "semaine" | "mois" | "annee";
type Terrain = { id: number; nom: string };
type Ligne = {
  id: number | string;
  date: string;
  heure_debut: string;
  joueur_nom: string;
  montant_avance: number;
  source?: string;
  terrain_nom?: string | null;
  joueur_telephone?: string;
  statut?: string;
};
type ParTerrain = {
  id?: number;
  nom: string;
  total_encaisse?: number;
  avances_recues?: number;
  matchs_joues?: number;
  a_venir?: number;
  nb_reservations?: number;
};

type FinancesData = {
  periode?: Periode;
  from?: string;
  to?: string;
  total_encaisse: number;
  encaisse_abonnements?: number;
  encaisse_tournois?: number;
  encaisse_blocages?: number;
  mention_blocages?: string;
  avances_recues: number;
  matchs_joues: number;
  a_venir: number;
  historique: Ligne[];
  graphique: Array<{ label: string; montant: number; matchs?: number; [key: string]: string | number | undefined }>;
  series?: Array<{ key: string; id: number; nom: string }>;
  par_terrain?: ParTerrain[];
  variation?: {
    label?: string;
    total_encaisse_precedent?: number;
    delta_pct?: number | null;
  } | null;
  confirmations_manuelles?: {
    nb_confirmations_manuelles?: number;
    avances_manuelles?: number;
  } | null;
  total_avances?: number;
  total_commission?: number;
  frais_payout_gerant?: number;
  montant_net?: number;
  soldes_encaissees?: number;
  montant_touche?: number;
  solde_a_retirer?: number;
  net_recu?: number;
  valeur_totale_matchs?: number;
  commission_pct?: number;
  delta_net_pct?: number | null;
};

const STACK_COLORS = ["#1E40AF", "#059669", "#D97706", "#7C3AED", "#0E7490", "#BE185D"];

const PERIODES: Array<{ id: Periode; label: string }> = [
  { id: "aujourd_hui", label: "Aujourd'hui" },
  { id: "semaine", label: "Cette semaine" },
  { id: "mois", label: "Ce mois" },
  { id: "annee", label: "Cette année" },
];

function formatLigneDate(date?: string, heure?: string) {
  if (!date) return "—";
  const d = new Date(`${date}T12:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  const jour = d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
  const h = String(heure || "").slice(0, 5);
  return h ? `${jour} · ${h}` : jour;
}

function statutBadge(item: Ligne) {
  const s = String(item.statut || item.source || "").toLowerCase();
  if (s.includes("joue") || s === "match_joue") return { label: "Joué ✓", color: "var(--p-optimal)", bg: "var(--p-optimal-bg)" };
  if (s.includes("attente")) return { label: "En attente", color: "var(--p-attention)", bg: "var(--p-attention-bg)" };
  if (s === "tournoi") return { label: "Tournoi", color: "var(--p-primary)", bg: "var(--p-primary-glow)" };
  if (s === "abonnement") return { label: "Abonnement", color: "var(--p-primary)", bg: "var(--p-primary-glow)" };
  return { label: "Confirmé", color: "var(--p-primary)", bg: "var(--p-primary-glow)" };
}

export default function OwnerReports() {
  const navigate = useNavigate();
  const [periode, setPeriode] = useState<Periode>("aujourd_hui");
  const [selectedTerrainId, setSelectedTerrainId] = useState<"all" | number>("all");
  const [terrains, setTerrains] = useState<Terrain[]>([]);
  const [data, setData] = useState<FinancesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const refreshTimer = useRef<number | null>(null);

  useEffect(() => {
    proprietaireApi
      .terrains()
      .then((list) => setTerrains(Array.isArray(list) ? list : []))
      .catch(() => setTerrains([]));
  }, []);

  const loadFinances = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      setError("");
      try {
        const payload = await proprietaireApi.finances(
          periode,
          selectedTerrainId === "all" ? undefined : selectedTerrainId,
        );
        setData(payload as FinancesData);
        setPage(1);
      } catch (err: any) {
        setData(null);
        setError(err?.message || "Impossible de charger les finances");
      } finally {
        setLoading(false);
      }
    },
    [periode, selectedTerrainId],
  );

  useEffect(() => {
    void loadFinances();
  }, [loadFinances]);

  useOwnerRealtime(terrains.map((t) => t.id), (ev) => {
    if (!["reservation", "encaissement", "blocage", "sante"].includes(String(ev.type))) return;
    if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
    refreshTimer.current = window.setTimeout(() => loadFinances(true), 350);
  });

  useEffect(() => {
    return () => {
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = data?.historique || [];
    if (!q) return rows;
    return rows.filter((item) => {
      const nom = String(item.joueur_nom || "").toLowerCase();
      const tel = String(item.joueur_telephone || "").replace(/\D/g, "");
      return nom.includes(q) || tel.includes(q.replace(/\D/g, ""));
    });
  }, [data, query]);

  const pageSize = 10;
  const visible = filtered.slice(0, page * pageSize);
  const hasMore = visible.length < filtered.length;
  const graphique = data?.graphique || [];
  const hasChart = graphique.some((p) => Number(p.montant) > 0);
  const blocages = Number(data?.encaisse_blocages || 0);
  const series = data?.series || [];
  const stacked = selectedTerrainId === "all" && series.length > 1;
  const caDelta = variationHint(data?.variation);
  const totalAvances = Number(data?.total_avances ?? data?.avances_recues ?? data?.total_encaisse ?? 0);
  const soldesEncaissees = Number(data?.soldes_encaissees || 0);
  const totalCommission = Number(data?.total_commission || 0);
  const fraisPayout = Number(data?.frais_payout_gerant || 0);
  const netGerant = Number(
    data?.montant_touche
      ?? Math.max(0, totalAvances + soldesEncaissees - totalCommission - fraisPayout),
  );
  const matchsJoues = Number(data?.matchs_joues || 0);
  const deltaNet =
    data?.delta_net_pct != null
      ? Number(data.delta_net_pct)
      : caDelta
        ? Number(data?.variation?.delta_pct)
        : undefined;

  const periodeLabel = PERIODES.find((p) => p.id === periode)?.label || periode;
  const terrainLabel =
    selectedTerrainId === "all"
      ? "Tous les terrains"
      : terrains.find((t) => Number(t.id) === Number(selectedTerrainId))?.nom || `Terrain #${selectedTerrainId}`;

  const exporterPdf = () => {
    if (!data) {
      toast.message("Aucune donnée à exporter");
      return;
    }
    try {
      exportFinancesPdf({
        titre: "Bilan financier propriétaire",
        roleLabel: "Espace propriétaire — pilotage",
        terrainLabel,
        periodeLabel,
        from: data.from,
        to: data.to,
        total_encaisse: data.total_encaisse,
        avances_recues: data.avances_recues,
        matchs_joues: data.matchs_joues,
        a_venir: data.a_venir,
        historique: data.historique || [],
        par_terrain: data.par_terrain,
        filename: `bilan-proprietaire-${periode}-${new Date().toISOString().slice(0, 10)}.pdf`,
      });
      toast.success("PDF téléchargé");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export PDF impossible");
    }
  };

  return (
    <div className="space-y-5 max-w-5xl mx-auto">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold leading-tight" style={{ fontFamily: "var(--font-display)", color: "var(--p-text)" }}>
            Mes revenus
          </h1>
          <p className="text-xs mt-1" style={{ color: "var(--p-muted)" }}>
            Bilans détaillés · export PDF
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => navigate("/backoffice/proprietaire/historique")}
            className="inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-xl text-sm font-semibold"
            style={{ background: "var(--p-primary-glow)", color: "var(--p-primary)" }}
          >
            <History className="w-4 h-4" />
            Historique
          </button>
          <button
            type="button"
            onClick={exporterPdf}
            disabled={!data}
            className="inline-flex items-center gap-1.5 min-h-[44px] px-3.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: "var(--p-primary)" }}
          >
            <Download className="w-4 h-4" />
            PDF
          </button>
        </div>
      </div>

      {terrains.length > 1 && (
        <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
          <button
            type="button"
            onClick={() => setSelectedTerrainId("all")}
            className="shrink-0 min-h-[44px] px-3.5 rounded-full text-xs font-semibold"
            style={{
              background: selectedTerrainId === "all" ? "var(--p-primary)" : "var(--p-surface-2)",
              color: selectedTerrainId === "all" ? "#fff" : "var(--p-muted)",
            }}
          >
            Tous
          </button>
          {terrains.map((t) => {
            const active = Number(selectedTerrainId) === Number(t.id);
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setSelectedTerrainId(Number(t.id))}
                className="shrink-0 min-h-[44px] px-3.5 rounded-full text-xs font-semibold max-w-[160px] truncate"
                style={{
                  background: active ? "var(--p-primary)" : "var(--p-surface-2)",
                  color: active ? "#fff" : "var(--p-muted)",
                }}
              >
                {t.nom}
              </button>
            );
          })}
        </div>
      )}

      <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
        {PERIODES.map((p) => {
          const actif = periode === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => setPeriode(p.id)}
              className="shrink-0 min-h-[44px] px-4 rounded-full text-sm font-semibold"
              style={{
                background: actif ? "var(--p-primary)" : "var(--p-surface-2)",
                color: actif ? "#fff" : "var(--p-muted)",
              }}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      {loading && !data ? (
        <div className="space-y-4 animate-pulse">
          <div className="h-36 rounded-2xl" style={{ background: "var(--p-surface-2)" }} />
          <div className="grid grid-cols-2 gap-2.5">
            {[1, 2].map((i) => (
              <div key={i} className="h-28 rounded-2xl" style={{ background: "var(--p-surface-2)" }} />
            ))}
          </div>
          <div className="h-52 rounded-2xl" style={{ background: "var(--p-surface-2)" }} />
        </div>
      ) : error ? (
        <p className="text-sm py-8 text-center" style={{ color: "var(--p-verifier)" }}>{error}</p>
      ) : data ? (
        <>
          <div className="space-y-3">
            <KpiMontantWave
              label="Chiffre d'affaires"
              montant={netGerant}
              icone={CheckCircle}
              couleur="var(--p-primary)"
              taille="hero"
              delta={deltaNet}
              souslabel="Reste encaissé + avances − commission"
              {...proprioKpiVars}
            />
            <div className="grid grid-cols-2 gap-3">
              <KpiMontantWave
                label="Avances joueurs"
                montant={totalAvances}
                icone={CreditCard}
                couleur="var(--p-info)"
                taille="normal"
                souslabel="Payé en ligne"
                {...proprioKpiVars}
              />
              <KpiMontantWave
                label="Matchs joués"
                montant={matchsJoues}
                icone={Activity}
                couleur="var(--p-accent, var(--p-gold))"
                taille="normal"
                format="nombre"
                {...proprioKpiVars}
              />
            </div>
            <KpiMontantWave
              label="À venir"
              montant={Number(data.a_venir || 0)}
              icone={CalendarClock}
              couleur="var(--p-info)"
              taille="petit"
              format="nombre"
              souslabel="résas confirmées"
              {...proprioKpiVars}
            />
          </div>

          {/* Ventilation transparente — montants uniquement, jamais de Wave/OM */}
          <div>
            <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--p-text)" }}>
              Détail de cette période
            </h3>
            <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid var(--p-border)" }}>
              <div
                className="flex justify-between items-center px-4 py-3.5"
                style={{ borderBottom: "1px solid var(--p-border)" }}
              >
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full" style={{ background: "var(--p-primary)" }} />
                  <span className="text-sm" style={{ color: "var(--p-text)" }}>
                    Encaissé total (avances joueurs)
                  </span>
                </div>
                <span className="font-bold text-sm" style={{ color: "var(--p-text)" }}>
                  {formaterMontant(Number(data.total_avances ?? data.total_encaisse))}
                </span>
              </div>

              <div
                className="flex justify-between items-center px-4 py-3.5"
                style={{ borderBottom: "1px solid var(--p-border)" }}
              >
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full" style={{ background: "var(--p-muted)" }} />
                  <span className="text-sm" style={{ color: "var(--p-text-2)" }}>
                    Commission TerrainSN
                    {Number(data.commission_pct) > 0 ? ` (${Number(data.commission_pct)}%)` : ""}
                  </span>
                </div>
                <span className="text-sm" style={{ color: "var(--p-danger)" }}>
                  −{formaterMontant(Number(data.total_commission || 0))}
                </span>
              </div>

              {Number(data.frais_payout_gerant || 0) > 0 ? (
                <div
                  className="flex justify-between items-center px-4 py-3.5"
                  style={{ borderBottom: "1px solid var(--p-border)" }}
                >
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full" style={{ background: "var(--p-muted)" }} />
                    <span className="text-sm" style={{ color: "var(--p-text-2)" }}>
                      Frais de reversement
                    </span>
                  </div>
                  <span className="text-sm" style={{ color: "var(--p-danger)" }}>
                    −{formaterMontant(Number(data.frais_payout_gerant || 0))}
                  </span>
                </div>
              ) : null}

              <div
                className="flex justify-between items-center px-4 py-4"
                style={{ background: "var(--p-success-subtle)" }}
              >
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4" style={{ color: "var(--p-success)" }} />
                  <span className="text-sm font-bold" style={{ color: "var(--p-success-text)" }}>
                    Net reçu par ton gérant
                  </span>
                </div>
                <span
                  className="font-black text-base"
                  style={{ color: "var(--p-success-text)", fontFamily: "var(--font-display)" }}
                >
                  {formaterMontant(Number(data.net_recu ?? data.montant_net ?? 0))}
                </span>
              </div>
            </div>
            <p className="text-xs mt-2 text-center" style={{ color: "var(--p-muted)" }}>
              Le &quot;Net reçu&quot; correspond aux reversements effectués sur le Wave/OM de ton gérant.
            </p>
          </div>

          {Number(data.confirmations_manuelles?.nb_confirmations_manuelles || 0) > 0 ? (
            <div className="rounded-xl px-3 py-2.5 text-xs" style={{ background: "var(--p-attention-bg)", border: "1px solid var(--p-attention)", color: "var(--p-text)" }}>
              <p className="inline-flex items-center gap-1.5 font-semibold">
                <Info size={14} style={{ color: "var(--p-attention)" }} />
                Confirmations manuelles ce mois
              </p>
              <p className="mt-1">
                {data.confirmations_manuelles?.nb_confirmations_manuelles} réservation(s) ce mois ont été confirmées manuellement
                par le gérant (paiement hors plateforme). La commission est en cours de recouvrement.
              </p>
              <p className="mt-1 font-semibold">Avances manuelles : {formatFcfa(Number(data.confirmations_manuelles?.avances_manuelles || 0))}</p>
            </div>
          ) : null}

          {blocages > 0 ? (
            <div className="rounded-xl px-3 py-2.5 text-xs" style={{ background: "var(--p-primary-glow)", color: "var(--p-text-2)" }}>
              Inclut {formatFcfa(blocages)} d'abonnements/tournois
            </div>
          ) : (
            <p className="text-xs" style={{ color: "var(--p-muted)" }}>
              Les abonnements et tournois ne sont pas encore pris en compte
            </p>
          )}

          {data.par_terrain && data.par_terrain.length > 1 ? (
            <section className="rounded-2xl p-3 space-y-2" style={{ background: "var(--p-surface)", boxShadow: "var(--p-shadow)" }}>
              <h2 className="text-sm font-semibold" style={{ color: "var(--p-text)" }}>Répartition par terrain</h2>
              {data.par_terrain.map((t) => (
                <div
                  key={t.id ?? t.nom}
                  className="flex items-center justify-between gap-3 rounded-xl px-3 py-2.5"
                  style={{ background: "var(--p-surface-2)" }}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate" style={{ color: "var(--p-text)" }}>{t.nom}</p>
                    <p className="text-[11px]" style={{ color: "var(--p-muted)" }}>
                      {t.matchs_joues || 0} joués · {t.a_venir || 0} à venir · {t.nb_reservations || 0} résas
                    </p>
                  </div>
                  <p className="text-sm font-bold shrink-0" style={{ color: "var(--p-primary)" }}>
                    {formatFcfa(t.total_encaisse)}
                  </p>
                </div>
              ))}
            </section>
          ) : null}

          <section className="rounded-2xl p-3" style={{ background: "var(--p-surface)", boxShadow: "var(--p-shadow)" }}>
            <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--p-text)" }}>Encaissements</h2>
            {hasChart ? (
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={graphique} margin={{ top: 8, right: 4, left: 0, bottom: stacked ? 8 : 0 }}>
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--p-muted)" }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                    <YAxis hide />
                    <Tooltip
                      content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null;
                        const row = payload[0]?.payload as { montant?: number; matchs?: number };
                        const matchs = Number(row?.matchs || 0);
                        return (
                          <div
                            className="rounded-xl px-3 py-2 text-xs"
                            style={{
                              border: "1px solid var(--p-border)",
                              background: "var(--p-surface)",
                              color: "var(--p-text)",
                            }}
                          >
                            <p className="font-semibold mb-1">{String(label)}</p>
                            {stacked
                              ? payload
                                  .filter((p) => Number(p.value || 0) > 0)
                                  .map((p) => (
                                    <p key={String(p.dataKey)} style={{ color: String(p.color) }}>
                                      {p.name} : {formatFcfa(Number(p.value || 0))}
                                    </p>
                                  ))
                              : (
                                <p>{formatFcfa(Number(row?.montant || 0))}</p>
                              )}
                            <p className="mt-1" style={{ color: "var(--p-muted)" }}>
                              {matchs} match{matchs > 1 ? "s" : ""}
                            </p>
                          </div>
                        );
                      }}
                    />
                    {stacked ? (
                      <>
                        {series.map((s, i) => (
                          <Bar
                            key={s.key}
                            dataKey={s.key}
                            name={s.nom}
                            stackId="terrains"
                            fill={STACK_COLORS[i % STACK_COLORS.length]}
                            radius={i === series.length - 1 ? [8, 8, 0, 0] : [0, 0, 0, 0]}
                          />
                        ))}
                        <Legend
                          iconType="circle"
                          wrapperStyle={{ fontSize: 11, color: "var(--p-muted)" }}
                        />
                      </>
                    ) : (
                      <Bar dataKey="montant" fill="#1E40AF" radius={[8, 8, 0, 0]} />
                    )}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="text-sm text-center py-10" style={{ color: "var(--p-muted)" }}>
                Aucun encaissement sur cette période. Change la période ou vérifie avec ton gérant.
              </p>
            )}
          </section>

          <section>
            <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--p-text)" }}>Historique des encaissements</h2>
            <div className="relative mb-3">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--p-muted)" }} />
              <input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(1);
                }}
                placeholder="Rechercher un joueur ou un numéro"
                className="w-full min-h-[44px] rounded-xl pl-9 pr-3 text-sm outline-none"
                style={{ background: "var(--p-surface-2)", color: "var(--p-text)" }}
              />
            </div>
            {filtered.length === 0 ? (
              <ProprioEmptyState
                title="Aucun encaissement sur cette période"
                subtitle="Change la période ou vérifie avec ton gérant."
              />
            ) : (
              <ul className="space-y-2">
                {visible.map((item) => {
                  const badge = statutBadge(item);
                  return (
                    <li
                      key={item.id}
                      className="rounded-xl p-3 flex items-center justify-between gap-3"
                      style={{ background: "var(--p-surface)", boxShadow: "var(--p-shadow)" }}
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate" style={{ color: "var(--p-text)" }}>{item.joueur_nom}</p>
                        <p className="text-xs mt-0.5" style={{ color: "var(--p-muted)" }}>
                          {formatLigneDate(item.date, item.heure_debut)}
                          {selectedTerrainId === "all" && item.terrain_nom ? ` · ${item.terrain_nom}` : ""}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-bold" style={{ color: "var(--p-optimal)" }}>{formatFcfa(item.montant_avance)}</p>
                        <span className="inline-block mt-1 text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: badge.bg, color: badge.color }}>
                          {badge.label}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {hasMore && (
              <button
                type="button"
                onClick={() => setPage((n) => n + 1)}
                className="w-full min-h-[44px] mt-3 rounded-xl text-sm font-semibold"
                style={{ background: "var(--p-surface-2)", color: "var(--p-primary)" }}
              >
                Voir plus
              </button>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
