import {
  Activity,
  CalendarCheck,
  CheckCircle2,
  ChevronRight,
  Clock,
  Grid3X3,
  MapPin,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { proprietaireApi, employesApi } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { useOwnerRealtime } from "@/hooks/useOwnerRealtime";
import { useAlertesProprietaire } from "@/hooks/useAlertesProprietaire";
import AlerteProprietaire from "@/espaces/backoffice/components/AlerteProprietaire";
import ProprioEmptyState from "@/espaces/backoffice/components/ProprioEmptyState";
import {
  activityMeta,
  formatFcfa,
  gerantPrenom,
  heatmapCellBg,
  heatmapCellFg,
  occupancyColor,
  relativeTime,
  santeCaTone,
  scoreTone,
  variationHint,
} from "@/espaces/backoffice/proprietaire/proprioUtils";

type Periode = "aujourd_hui" | "semaine" | "mois" | "annee";
type Terrain = { id: number; nom: string };
type Sante = {
  score_confiance: number;
  matchs_scannes: number;
  total_confirmes: number;
  activite_recente?: Array<{ action: string; created_at?: string }>;
  score_sante_enabled?: boolean;
};
type ProchainMatch = {
  id: number;
  date: string;
  heure_debut?: string;
  joueur_nom?: string;
  terrain_nom?: string;
  statut?: string;
  montant_avance?: number;
};

const PERIODES: Array<{ id: Periode; label: string; short: string }> = [
  { id: "aujourd_hui", label: "Aujourd'hui", short: "Jour" },
  { id: "semaine", label: "Cette semaine", short: "Semaine" },
  { id: "mois", label: "Ce mois", short: "Mois" },
  { id: "annee", label: "Cette année", short: "Année" },
];

function formatMatchSlot(date?: string, heure?: string) {
  if (!date) return "—";
  const d = new Date(`${date}T12:00:00`);
  const jour = Number.isNaN(d.getTime())
    ? date
    : d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
  const h = String(heure || "").slice(0, 5);
  return h ? `${jour} · ${h}` : jour;
}

const OwnerDashboard = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, isAuthenticated } = useAuth();
  const [stats, setStats] = useState<any>(null);
  const [terrains, setTerrains] = useState<Terrain[]>([]);
  const [santes, setSantes] = useState<Record<string, Sante>>({});
  const [employes, setEmployes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [periode, setPeriode] = useState<Periode>("aujourd_hui");
  const [selectedTerrainId, setSelectedTerrainId] = useState<"all" | number>("all");
  const [lastUpdated, setLastUpdated] = useState<number>(Date.now());
  const [tick, setTick] = useState(0);
  const refreshTimer = useRef<number | null>(null);

  useEffect(() => {
    if (searchParams.get("view") === "terrains") {
      navigate("/backoffice/proprietaire/terrains", { replace: true });
    }
  }, [navigate, searchParams]);

  const loadData = useCallback(
    async (quiet = false) => {
      try {
        if (!quiet) setLoading(true);
        const [s, t, e] = await Promise.all([
          proprietaireApi.stats({
            periode,
            terrainId: selectedTerrainId === "all" ? undefined : selectedTerrainId,
          }),
          proprietaireApi.terrains(),
          employesApi.list().catch(() => []),
        ]);
        const terrainList = Array.isArray(t) ? t : [];
        setStats(s);
        setTerrains(terrainList);
        setEmployes(Array.isArray(e) ? e : []);

        const healthEntries = await Promise.all(
          terrainList.map(async (terrain: Terrain) => {
            try {
              const health = await proprietaireApi.santeTerrain(terrain.id);
              return [String(terrain.id), health] as const;
            } catch {
              return [String(terrain.id), null] as const;
            }
          }),
        );
        setSantes(Object.fromEntries(healthEntries.filter(([, value]) => value)));
        setLastUpdated(Date.now());
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    },
    [periode, selectedTerrainId],
  );

  useEffect(() => {
    if (!isAuthenticated || (user?.role !== "proprietaire" && user?.accountType !== "proprietaire")) {
      navigate("/login");
      return;
    }
    loadData();
  }, [isAuthenticated, loadData, navigate, user?.accountType, user?.role]);

  const scheduleLiveRefresh = useCallback(() => {
    if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
    refreshTimer.current = window.setTimeout(() => loadData(true), 400);
  }, [loadData]);

  const live = useOwnerRealtime(
    terrains.map((t) => t.id),
    (ev) => {
      if (["reservation", "encaissement", "sante", "score", "statut", "blocage", "horaires"].includes(String(ev.type))) {
        scheduleLiveRefresh();
      }
    },
  );

  useEffect(() => {
    const timer = window.setInterval(() => {
      loadData(true);
      setTick((n) => n + 1);
    }, 8000);
    return () => window.clearInterval(timer);
  }, [loadData]);

  useEffect(() => {
    const clock = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(clock);
  }, []);

  useEffect(() => {
    return () => {
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
    };
  }, []);

  const gerantByTerrain = useMemo(() => {
    const map: Record<string, any> = {};
    for (const e of employes) {
      if (e.terrain_id == null) continue;
      const key = String(e.terrain_id);
      if (!map[key] && Number(e.is_active) !== 0) map[key] = e;
    }
    return map;
  }, [employes]);

  const displayStats = stats;
  const matchsJoues = Number(displayStats?.matchsJoues ?? 0);
  const totalResas = Number(displayStats?.totalReservations ?? 0);
  const aVenir = Number(displayStats?.aVenir ?? Math.max(0, totalResas - matchsJoues));
  const multiTerrains = terrains.length > 1;
  const periodeMeta = PERIODES.find((p) => p.id === periode) || PERIODES[0];

  const topTerrain = useMemo(() => {
    const list = displayStats?.terrainStats || [];
    if (!list.length) return null;
    return [...list].sort((a: any, b: any) => (b.revenue || 0) - (a.revenue || 0))[0];
  }, [displayStats]);

  const healthRows = useMemo(() => {
    const list = selectedTerrainId === "all" ? terrains : terrains.filter((t) => Number(t.id) === Number(selectedTerrainId));
    return list
      .map((terrain) => ({
        terrain,
        health: santes[String(terrain.id)],
        gerant: gerantByTerrain[String(terrain.id)],
      }))
      .filter((row) => row.health && row.health.score_sante_enabled !== false)
      .slice(0, 4);
  }, [terrains, selectedTerrainId, santes, gerantByTerrain]);

  const alertInputs = useMemo(() => {
    const list = selectedTerrainId === "all" ? terrains : terrains.filter((t) => Number(t.id) === Number(selectedTerrainId));
    return list.map((terrain) => {
      const row = (stats?.terrainStats || []).find((t: any) => Number(t.id) === Number(terrain.id));
      const gerant = gerantByTerrain[String(terrain.id)];
      return {
        id: terrain.id,
        nom: terrain.nom,
        score_confiance: santes[String(terrain.id)]?.score_confiance,
        occupation_mois: Number(row?.occupancy ?? stats?.occupancyRate ?? 100),
        gerant_id: gerant?.id ?? null,
        gerant_prenom: gerantPrenom(gerant),
      };
    });
  }, [terrains, selectedTerrainId, stats, santes, gerantByTerrain]);

  const alertes = useAlertesProprietaire(alertInputs);

  const feed = useMemo(() => {
    const items: Array<{ key: string; action: string; created_at?: string; terrain_nom: string }> = [];
    for (const terrain of terrains) {
      if (selectedTerrainId !== "all" && Number(terrain.id) !== Number(selectedTerrainId)) continue;
      const acts = santes[String(terrain.id)]?.activite_recente || [];
      acts.forEach((a, i) => {
        items.push({
          key: `${terrain.id}-${a.action}-${a.created_at}-${i}`,
          action: a.action,
          created_at: a.created_at,
          terrain_nom: terrain.nom,
        });
      });
    }
    return items
      .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))
      .slice(0, 5);
  }, [terrains, santes, selectedTerrainId]);

  const chartData = useMemo(() => {
    const g = displayStats?.graphique || displayStats?.weeklyRevenue || [];
    return g.map((p: any) => ({
      label: p.label || p.day,
      montant: Number(p.montant ?? p.revenue ?? 0),
      matchs: Number(p.matchs || 0),
    }));
  }, [displayStats]);

  const hasChart = chartData.some((p: { montant: number }) => p.montant > 0);
  const prochains: ProchainMatch[] = Array.isArray(displayStats?.prochains_matchs)
    ? displayStats.prochains_matchs
    : [];

  const heatmap = displayStats?.heatmap;
  const heatmapJours: Array<{ key: number; label: string }> = heatmap?.jours || [];
  const heatmapHeures: Array<{ key: number; label: string }> = heatmap?.heures || [];
  const heatmapCells: Array<{
    jour: number;
    heure: number;
    montant: number;
    matchs: number;
    intensite: number;
  }> = heatmap?.cells || [];
  const cellMap = useMemo(() => {
    const m = new Map<string, (typeof heatmapCells)[0]>();
    for (const c of heatmapCells) m.set(`${c.jour}-${c.heure}`, c);
    return m;
  }, [heatmapCells]);
  const showHeatmap = Boolean(heatmap?.has_data && heatmapHeures.length > 0);

  const perfTerrains: Array<{
    id: number;
    nom: string;
    revenue?: number;
    occupancy?: number;
    score_confiance?: number;
    taux_scan?: number;
    matchsJoues?: number;
    reservations?: number;
  }> = Array.isArray(displayStats?.perf_terrains)
    ? displayStats.perf_terrains
    : displayStats?.terrainStats || [];

  const santeCa = displayStats?.sante_ca;
  const santeTone = santeCaTone(santeCa?.statut);

  const agoSec = Math.max(0, Math.round((Date.now() - lastUpdated) / 1000));
  void tick;

  if (loading && !stats) {
    return (
      <div className="space-y-3 max-w-5xl mx-auto animate-pulse">
        <div className="h-8 w-40 rounded-lg" style={{ background: "var(--p-surface-2)" }} />
        <div className="grid grid-cols-2 gap-2.5">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 rounded-2xl" style={{ background: "var(--p-surface-2)" }} />
          ))}
        </div>
      </div>
    );
  }

  if (!terrains.length) {
    return (
      <ProprioEmptyState
        title="Aucun terrain associé pour le moment"
        subtitle="Contacte l'administration pour en ajouter un. Les données apparaîtront dès la première réservation confirmée."
      />
    );
  }

  const occ = Number(displayStats?.occupancyRate || 0);
  const noActivity = totalResas === 0 && Number(displayStats?.totalRevenue || 0) === 0;
  const showPerf = !noActivity && perfTerrains.length > 0;
  const caDelta = variationHint(displayStats?.variation);
  const matchLabel =
    periode === "aujourd_hui"
      ? "Matchs aujourd'hui"
      : periode === "semaine"
        ? "Matchs cette semaine"
        : periode === "annee"
          ? "Matchs cette année"
          : "Matchs ce mois";

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold leading-tight" style={{ fontFamily: "var(--font-display)", color: "var(--p-text)" }}>
            Aperçu
          </h1>
          <p className="text-[11px] mt-0.5" style={{ color: "var(--p-muted)" }}>
            {periodeMeta.label} · {live ? "En direct" : `Mis à jour il y a ${agoSec}s`}
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium">
          <span className={`w-1.5 h-1.5 rounded-full ${live ? "animate-pulse" : ""}`} style={{ background: live ? "var(--p-live)" : "var(--p-verifier)" }} />
          <span style={{ color: live ? "var(--p-optimal)" : "var(--p-muted)" }}>{live ? "En direct" : "Hors ligne"}</span>
        </span>
      </div>

      <div className="-mx-0.5 overflow-x-auto">
        <div className="flex gap-1.5 px-0.5 min-w-max pb-0.5">
          {PERIODES.map((p) => {
            const actif = periode === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setPeriode(p.id)}
                className="shrink-0 min-h-[36px] px-3.5 rounded-full text-[11px] font-semibold"
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
      </div>

      {alertes.length > 0 && (
        <div className="space-y-2">
          {alertes.map((alerte, i) => (
            <AlerteProprietaire key={`${alerte.terrain_nom}-${alerte.message}-${i}`} alerte={alerte} />
          ))}
        </div>
      )}

      {multiTerrains && (
        <div className="-mx-0.5 overflow-x-auto">
          <div className="flex gap-1.5 px-0.5 min-w-max pb-0.5">
            <button
              type="button"
              onClick={() => setSelectedTerrainId("all")}
              className="shrink-0 min-h-[36px] px-3.5 rounded-full text-[11px] font-semibold"
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
                  className="shrink-0 min-h-[36px] px-3.5 rounded-full text-[11px] font-semibold max-w-[160px] truncate"
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
        </div>
      )}

      {noActivity ? (
        <ProprioEmptyState
          title={`Pas encore d'activité · ${periodeMeta.label.toLowerCase()}`}
          subtitle="Les données apparaîtront dès la première réservation confirmée sur cette période."
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2.5">
            <div className="rounded-2xl p-4" style={{ background: "var(--p-surface)", boxShadow: "var(--p-shadow)" }}>
              <span className="inline-flex w-8 h-8 rounded-full items-center justify-center" style={{ background: "var(--p-primary-glow)" }}>
                <TrendingUp className="w-4 h-4" style={{ color: "var(--p-primary)" }} />
              </span>
              <p className="mt-2 text-[22px] font-bold leading-none" style={{ fontFamily: "var(--font-display)", color: "var(--p-text)" }}>
                {formatFcfa(displayStats?.totalRevenue)}
              </p>
              <p className="text-[11px] mt-1" style={{ color: "var(--p-muted)" }}>Chiffre d'affaires</p>
              {caDelta ? (
                <p className="text-[11px] mt-1 font-semibold" style={{ color: caDelta.positive ? "var(--p-optimal)" : "var(--p-verifier)" }}>
                  {caDelta.text}
                </p>
              ) : null}
            </div>

            <div className="rounded-2xl p-4" style={{ background: "var(--p-surface)", boxShadow: "var(--p-shadow)" }}>
              <span className="inline-flex w-8 h-8 rounded-full items-center justify-center" style={{ background: "var(--p-gold-glow)" }}>
                <Activity className="w-4 h-4" style={{ color: "var(--p-gold)" }} />
              </span>
              <p className="mt-2 text-[22px] font-bold leading-none" style={{ fontFamily: "var(--font-display)", color: "var(--p-text)" }}>
                {occ}%
              </p>
              <p className="text-[11px] mt-1" style={{ color: "var(--p-muted)" }}>Taux d'occupation</p>
              <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--p-surface-2)" }}>
                <div className="h-full" style={{ width: `${Math.max(0, Math.min(100, occ))}%`, background: occupancyColor(occ) }} />
              </div>
            </div>

            <div className="rounded-2xl p-4" style={{ background: "var(--p-surface)", boxShadow: "var(--p-shadow)" }}>
              <span className="inline-flex w-8 h-8 rounded-full items-center justify-center" style={{ background: "var(--p-optimal-bg)" }}>
                <CheckCircle2 className="w-4 h-4" style={{ color: "var(--p-optimal)" }} />
              </span>
              <p className="mt-2 text-[22px] font-bold leading-none" style={{ fontFamily: "var(--font-display)", color: "var(--p-text)" }}>
                {matchsJoues} / {totalResas}
              </p>
              <p className="text-[11px] mt-1" style={{ color: "var(--p-muted)" }}>{matchLabel}</p>
            </div>

            <div className="rounded-2xl p-4" style={{ background: "var(--p-surface)", boxShadow: "var(--p-shadow)" }}>
              {multiTerrains && selectedTerrainId === "all" ? (
                <>
                  <span className="inline-flex w-8 h-8 rounded-full items-center justify-center" style={{ background: "var(--p-primary-glow)" }}>
                    <MapPin className="w-4 h-4" style={{ color: "var(--p-primary)" }} />
                  </span>
                  <p className="mt-2 text-sm font-bold leading-snug" style={{ fontFamily: "var(--font-display)", color: "var(--p-text)" }}>
                    {topTerrain?.nom || "—"}
                  </p>
                  <p className="text-[12px] font-semibold mt-1" style={{ color: "var(--p-optimal)" }}>
                    {formatFcfa(topTerrain?.revenue)}
                  </p>
                  <p className="text-[11px] mt-1" style={{ color: "var(--p-muted)" }}>Meilleur terrain</p>
                </>
              ) : (
                <>
                  <span className="inline-flex w-8 h-8 rounded-full items-center justify-center" style={{ background: "var(--p-primary-glow)" }}>
                    <CalendarCheck className="w-4 h-4" style={{ color: "var(--p-primary)" }} />
                  </span>
                  <p className="mt-2 text-[22px] font-bold leading-none" style={{ fontFamily: "var(--font-display)", color: "var(--p-text)" }}>
                    {aVenir}
                  </p>
                  <p className="text-[11px] mt-1" style={{ color: "var(--p-muted)" }}>À venir</p>
                </>
              )}
            </div>
          </div>

          {santeCa?.resume ? (
            <section
              className="rounded-2xl p-4 space-y-2"
              style={{ background: "var(--p-surface)", boxShadow: "var(--p-shadow)" }}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="inline-flex w-8 h-8 rounded-full items-center justify-center shrink-0" style={{ background: santeTone.bg }}>
                    <ShieldCheck className="w-4 h-4" style={{ color: santeTone.color }} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[14px] font-semibold" style={{ color: "var(--p-text)" }}>
                      Santé × CA
                    </p>
                    <p className="text-[12px] mt-0.5" style={{ color: "var(--p-text-2)" }}>
                      {santeCa.resume}
                    </p>
                  </div>
                </div>
                <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full shrink-0" style={{ background: santeTone.bg, color: santeTone.color }}>
                  {santeTone.label}
                </span>
              </div>
              <div className="flex flex-wrap gap-3 text-[11px]" style={{ color: "var(--p-muted)" }}>
                {santeCa.score_moyen != null ? <span>Score moyen {santeCa.score_moyen}/100</span> : null}
                {santeCa.occupation_moyenne != null ? <span>Occupation {santeCa.occupation_moyenne}%</span> : null}
                <span>CA {formatFcfa(santeCa.ca_total)}</span>
              </div>
              {Array.isArray(santeCa.alertes) && santeCa.alertes.length > 0 ? (
                <ul className="space-y-1.5 pt-1">
                  {santeCa.alertes.slice(0, 3).map((a: { type?: string; message?: string; terrain_id?: number }, i: number) => (
                    <li key={`${a.terrain_id}-${i}`} className="text-[12px] rounded-xl px-3 py-2" style={{ background: "var(--p-surface-2)", color: "var(--p-text)" }}>
                      {a.message}
                    </li>
                  ))}
                </ul>
              ) : null}
              <button
                type="button"
                onClick={() => navigate("/backoffice/proprietaire/sante")}
                className="text-[12px] font-medium min-h-[36px]"
                style={{ color: "var(--p-primary)" }}
              >
                Voir la santé détaillée →
              </button>
            </section>
          ) : null}

          {hasChart ? (
            <section className="rounded-2xl p-4" style={{ background: "var(--p-surface)", boxShadow: "var(--p-shadow)" }}>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-[14px] font-semibold" style={{ color: "var(--p-text)" }}>
                  Encaissements · {periodeMeta.short.toLowerCase()}
                </h2>
                <button
                  type="button"
                  onClick={() => navigate("/backoffice/proprietaire/revenus")}
                  className="text-[12px] font-medium min-h-[36px]"
                  style={{ color: "var(--p-primary)" }}
                >
                  Détails →
                </button>
              </div>
              <div className="h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                    <XAxis
                      dataKey="label"
                      tick={{ fill: "var(--p-muted)", fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                      interval={periode === "mois" ? 2 : 0}
                    />
                    <YAxis
                      tick={{ fill: "var(--p-muted)", fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v) => (Number(v) >= 1000 ? `${Math.round(Number(v) / 1000)}k` : String(v))}
                    />
                    <Tooltip
                      cursor={{ fill: "var(--p-surface-2)" }}
                      contentStyle={{
                        background: "var(--p-surface)",
                        border: "1px solid var(--p-border)",
                        borderRadius: 12,
                        fontSize: 12,
                      }}
                      formatter={(value: number) => [formatFcfa(value), "CA"]}
                    />
                    <Bar dataKey="montant" fill="var(--p-primary)" radius={[6, 6, 0, 0]} maxBarSize={28} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>
          ) : null}

          {showHeatmap ? (
            <section className="rounded-2xl p-4 space-y-3" style={{ background: "var(--p-surface)", boxShadow: "var(--p-shadow)" }}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Grid3X3 className="w-4 h-4 shrink-0" style={{ color: "var(--p-primary)" }} />
                  <h2 className="text-[14px] font-semibold truncate" style={{ color: "var(--p-text)" }}>
                    Heatmap des créneaux
                  </h2>
                </div>
                <p className="text-[11px] shrink-0" style={{ color: "var(--p-muted)" }}>
                  Plus foncé = plus de CA
                </p>
              </div>
              <div className="overflow-x-auto -mx-1 px-1">
                <div
                  className="inline-grid gap-1 min-w-max"
                  style={{
                    gridTemplateColumns: `36px repeat(${heatmapHeures.length}, minmax(28px, 36px))`,
                  }}
                >
                  <div />
                  {heatmapHeures.map((h) => (
                    <div key={h.key} className="text-[9px] text-center font-medium" style={{ color: "var(--p-muted)" }}>
                      {h.label.replace("h", "")}
                    </div>
                  ))}
                  {heatmapJours.map((j) => (
                    <div key={`row-${j.key}`} className="contents">
                      <div className="text-[10px] font-semibold flex items-center" style={{ color: "var(--p-muted)" }}>
                        {j.label}
                      </div>
                      {heatmapHeures.map((h) => {
                        const cell = cellMap.get(`${j.key}-${h.key}`);
                        const intensite = Number(cell?.intensite || 0);
                        return (
                          <div
                            key={`${j.key}-${h.key}`}
                            title={`${j.label} ${h.label} · ${formatFcfa(cell?.montant)} · ${cell?.matchs || 0} match(s)`}
                            className="h-7 rounded-md flex items-center justify-center text-[9px] font-semibold"
                            style={{
                              background: heatmapCellBg(intensite),
                              color: heatmapCellFg(intensite),
                            }}
                          >
                            {intensite >= 0.35 && cell?.matchs ? cell.matchs : ""}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
              {(heatmap?.top_creneaux?.length > 0 || heatmap?.creneaux_froids?.length > 0) && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                  {heatmap?.top_creneaux?.length > 0 ? (
                    <div className="rounded-xl px-3 py-2" style={{ background: "var(--p-surface-2)" }}>
                      <p className="font-semibold mb-1" style={{ color: "var(--p-optimal)" }}>Top créneaux</p>
                      {heatmap.top_creneaux.slice(0, 3).map((c: { label: string; montant: number }, i: number) => (
                        <p key={`${c.label}-${i}`} style={{ color: "var(--p-text-2)" }}>
                          {c.label} · {formatFcfa(c.montant)}
                        </p>
                      ))}
                    </div>
                  ) : null}
                  {heatmap?.creneaux_froids?.length > 0 ? (
                    <div className="rounded-xl px-3 py-2" style={{ background: "var(--p-surface-2)" }}>
                      <p className="font-semibold mb-1" style={{ color: "var(--p-attention)" }}>Créneaux calmes</p>
                      {heatmap.creneaux_froids.slice(0, 3).map((c: { label: string; montant: number }, i: number) => (
                        <p key={`${c.label}-${i}`} style={{ color: "var(--p-text-2)" }}>
                          {c.label} · {formatFcfa(c.montant)}
                        </p>
                      ))}
                    </div>
                  ) : null}
                </div>
              )}
            </section>
          ) : null}

          {showPerf ? (
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="text-[14px] font-semibold" style={{ color: "var(--p-text)" }}>
                  Performance par terrain
                </h2>
                <button
                  type="button"
                  onClick={() => navigate("/backoffice/proprietaire/terrains")}
                  className="text-[12px] font-medium min-h-[44px]"
                  style={{ color: "var(--p-primary)" }}
                >
                  Terrains →
                </button>
              </div>
              <div className="rounded-2xl divide-y overflow-hidden" style={{ background: "var(--p-surface)", boxShadow: "var(--p-shadow)", borderColor: "var(--p-border)" }}>
                <div className="hidden sm:grid grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(0,1fr))] gap-2 px-4 py-2 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--p-muted)", background: "var(--p-surface-2)" }}>
                  <span>Terrain</span>
                  <span className="text-right">CA</span>
                  <span className="text-right">Occupation</span>
                  <span className="text-right">Score</span>
                  <span className="text-right">Matchs</span>
                </div>
                {perfTerrains.map((row) => {
                  const score = Number(row.score_confiance ?? 100);
                  const tone = scoreTone(score);
                  const scoreColor =
                    tone === "vert" ? "var(--p-optimal)" : tone === "orange" ? "var(--p-attention)" : "var(--p-verifier)";
                  return (
                    <button
                      key={row.id}
                      type="button"
                      onClick={() => navigate(`/backoffice/proprietaire/terrain/${row.id}`)}
                      className="w-full text-left px-4 py-3 grid grid-cols-1 sm:grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(0,1fr))] gap-1 sm:gap-2 items-center"
                    >
                      <div className="min-w-0">
                        <p className="text-[13px] font-semibold truncate" style={{ color: "var(--p-text)" }}>{row.nom}</p>
                        <p className="text-[11px] sm:hidden" style={{ color: "var(--p-muted)" }}>
                          {formatFcfa(row.revenue)} · {Number(row.occupancy || 0)}% · score {score}
                        </p>
                      </div>
                      <p className="hidden sm:block text-right text-[12px] font-semibold" style={{ color: "var(--p-text)" }}>
                        {formatFcfa(row.revenue)}
                      </p>
                      <p className="hidden sm:block text-right text-[12px]" style={{ color: occupancyColor(Number(row.occupancy || 0)) }}>
                        {Number(row.occupancy || 0)}%
                      </p>
                      <p className="hidden sm:block text-right text-[12px] font-semibold" style={{ color: scoreColor }}>
                        {score}/100
                      </p>
                      <p className="hidden sm:block text-right text-[12px]" style={{ color: "var(--p-muted)" }}>
                        {Number(row.matchsJoues || 0)}/{Number(row.reservations || 0)}
                      </p>
                    </button>
                  );
                })}
              </div>
            </section>
          ) : null}

          {prochains.length > 0 ? (
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="text-[14px] font-semibold" style={{ color: "var(--p-text)" }}>
                  Prochains matchs
                </h2>
                <button
                  type="button"
                  onClick={() => navigate("/backoffice/proprietaire/historique")}
                  className="text-[12px] font-medium min-h-[44px]"
                  style={{ color: "var(--p-primary)" }}
                >
                  Historique →
                </button>
              </div>
              <div className="rounded-2xl divide-y" style={{ background: "var(--p-surface)", boxShadow: "var(--p-shadow)", borderColor: "var(--p-border)" }}>
                {prochains.map((m) => (
                  <div key={m.id} className="px-4 py-3 flex items-center gap-3">
                    <span className="h-9 w-9 rounded-full inline-flex items-center justify-center shrink-0" style={{ background: "var(--p-primary-glow)" }}>
                      <Clock className="h-4 w-4" style={{ color: "var(--p-primary)" }} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate" style={{ color: "var(--p-text)" }}>
                        {m.joueur_nom || "Joueur"}
                      </p>
                      <p className="text-[11px] truncate" style={{ color: "var(--p-muted)" }}>
                        {formatMatchSlot(m.date, m.heure_debut)}
                        {m.terrain_nom ? ` · ${m.terrain_nom}` : ""}
                      </p>
                    </div>
                    <p className="text-[11px] font-semibold shrink-0" style={{ color: "var(--p-optimal)" }}>
                      {formatFcfa(m.montant_avance)}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-[14px] font-semibold" style={{ color: "var(--p-text)" }}>Tes gérants</h2>
          <button
            type="button"
            onClick={() => navigate("/backoffice/proprietaire/sante")}
            className="text-[12px] font-medium min-h-[44px]"
            style={{ color: "var(--p-primary)" }}
          >
            Voir détails →
          </button>
        </div>
        {healthRows.length === 0 ? (
          <p className="text-sm py-4" style={{ color: "var(--p-muted)" }}>Pas encore assez de données</p>
        ) : (
          <div className="space-y-2">
            {healthRows.map(({ terrain, health, gerant }) => {
              const score = Number(health.score_confiance || 0);
              const tone = scoreTone(score);
              const badge =
                tone === "vert"
                  ? { label: "Optimal ✓", bg: "var(--p-optimal-bg)", color: "var(--p-optimal)" }
                  : tone === "orange"
                    ? { label: "Attention", bg: "var(--p-attention-bg)", color: "var(--p-attention)" }
                    : { label: "À vérifier", bg: "var(--p-verifier-bg)", color: "var(--p-verifier)" };
              return (
                <button
                  key={terrain.id}
                  type="button"
                  onClick={() => navigate(`/backoffice/proprietaire/sante?terrain=${terrain.id}`)}
                  className="w-full text-left rounded-xl px-4 h-[52px] flex items-center gap-3"
                  style={{ background: "var(--p-surface)", boxShadow: "var(--p-shadow)" }}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold truncate" style={{ color: "var(--p-text)" }}>{terrain.nom}</p>
                    <p className="text-[11px] truncate" style={{ color: "var(--p-muted)" }}>
                      {gerantPrenom(gerant) ? `Gérant : ${gerantPrenom(gerant)}` : "Aucun gérant"}
                    </p>
                  </div>
                  <p className="text-[12px] shrink-0 hidden sm:block" style={{ color: "var(--p-text-2)" }}>
                    {health.matchs_scannes}/{health.total_confirmes} matchs validés
                  </p>
                  <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full shrink-0" style={{ background: badge.bg, color: badge.color }}>
                    {badge.label}
                  </span>
                  <ChevronRight className="w-4 h-4 shrink-0" style={{ color: "var(--p-muted)" }} />
                </button>
              );
            })}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-[14px] font-semibold" style={{ color: "var(--p-text)" }}>Activité récente</h2>
          <button
            type="button"
            onClick={() => navigate("/backoffice/proprietaire/sante")}
            className="text-[12px] font-medium min-h-[44px]"
            style={{ color: "var(--p-primary)" }}
          >
            Voir tout
          </button>
        </div>
        {feed.length === 0 ? (
          <p className="text-sm py-4 text-center" style={{ color: "var(--p-muted)" }}>Pas encore assez de données</p>
        ) : (
          <div className="rounded-2xl divide-y" style={{ background: "var(--p-surface)", boxShadow: "var(--p-shadow)", borderColor: "var(--p-border)" }}>
            {feed.map((item) => {
              const meta = activityMeta(item.action);
              return (
                <div key={item.key} className="p-fade-slide-down px-4 py-3 flex items-center gap-3">
                  <span className="h-9 w-9 rounded-full inline-flex items-center justify-center shrink-0" style={{ background: "var(--p-surface-2)" }}>
                    <meta.Icon className="h-4 w-4" style={{ color: meta.color }} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate" style={{ color: "var(--p-text)" }}>{meta.label}</p>
                    <p className="text-[11px] truncate" style={{ color: "var(--p-muted)" }}>{item.terrain_nom}</p>
                  </div>
                  <p className="text-[11px] shrink-0" style={{ color: "var(--p-muted)" }}>{relativeTime(item.created_at)}</p>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};

export default OwnerDashboard;
