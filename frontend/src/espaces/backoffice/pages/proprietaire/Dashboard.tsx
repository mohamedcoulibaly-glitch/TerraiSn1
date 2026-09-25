import {
  Activity,
  CalendarCheck,
  CheckCircle2,
  ChevronRight,
  MapPin,
  TrendingUp,
} from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
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
  occupancyColor,
  relativeTime,
  scoreTone,
  variationHint,
} from "@/espaces/backoffice/proprietaire/proprioUtils";

type Terrain = { id: number; nom: string };
type Sante = {
  score_confiance: number;
  matchs_scannes: number;
  total_confirmes: number;
  activite_recente?: Array<{ action: string; created_at?: string }>;
  score_sante_enabled?: boolean;
};

const OwnerDashboard = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, isAuthenticated } = useAuth();
  const [stats, setStats] = useState<any>(null);
  const [terrains, setTerrains] = useState<Terrain[]>([]);
  const [santes, setSantes] = useState<Record<string, Sante>>({});
  const [employes, setEmployes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTerrainId, setSelectedTerrainId] = useState<"all" | number>("all");
  const [lastUpdated, setLastUpdated] = useState<number>(Date.now());
  const [tick, setTick] = useState(0);
  const refreshTimer = useRef<number | null>(null);

  useEffect(() => {
    if (searchParams.get("view") === "terrains") {
      navigate("/backoffice/proprietaire/terrains", { replace: true });
    }
  }, [navigate, searchParams]);

  const loadData = useCallback(async (quiet = false) => {
    try {
      if (!quiet) setLoading(true);
      const [s, t, e] = await Promise.all([
        proprietaireApi.stats(),
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
  }, []);

  useEffect(() => {
    if (!isAuthenticated || (user?.role !== "proprietaire" && user?.accountType !== "proprietaire")) {
      navigate("/backoffice/login");
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

  const filteredStats = useMemo(() => {
    if (selectedTerrainId === "all" || !stats) return stats;
    const row = (stats.terrainStats || []).find((t: any) => Number(t.id) === Number(selectedTerrainId));
    if (!row) return stats;
    return {
      ...stats,
      totalRevenue: row.revenue || 0,
      totalReservations: row.reservations || 0,
      occupancyRate: row.occupancy || 0,
      matchsJoues: row.matchsJoues ?? 0,
      variation: row.variation || null,
      terrainStats: [row],
    };
  }, [stats, selectedTerrainId]);

  const displayStats = filteredStats || stats;
  const matchsJoues = Number(displayStats?.matchsJoues ?? 0);
  const totalResas = Number(displayStats?.totalReservations ?? 0);
  const aVenir = Math.max(0, totalResas - matchsJoues);
  const multiTerrains = terrains.length > 1;

  const topTerrain = useMemo(() => {
    const list = displayStats?.terrainStats || stats?.terrainStats || [];
    if (!list.length) return null;
    return [...list].sort((a: any, b: any) => (b.revenue || 0) - (a.revenue || 0))[0];
  }, [displayStats, stats]);

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
        occupation_mois: Number(row?.occupancy ?? 100),
        gerant_id: gerant?.id ?? null,
        gerant_prenom: gerantPrenom(gerant),
      };
    });
  }, [terrains, selectedTerrainId, stats, santes, gerantByTerrain]);

  const alertes = useAlertesProprietaire(alertInputs);

  const feed = useMemo(() => {
    const items: Array<{ key: string; action: string; created_at?: string; terrain_nom: string }> = [];
    for (const terrain of terrains) {
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
  }, [terrains, santes]);

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
  const caDelta = variationHint(displayStats?.variation);

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold leading-tight" style={{ fontFamily: "var(--font-display)", color: "var(--p-text)" }}>
            Aperçu
          </h1>
          <p className="text-[11px] mt-0.5" style={{ color: "var(--p-muted)" }}>
            Ce mois · {live ? "En direct" : `Mis à jour il y a ${agoSec}s`}
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium">
          <span className={`w-1.5 h-1.5 rounded-full ${live ? "animate-pulse" : ""}`} style={{ background: live ? "var(--p-live)" : "var(--p-verifier)" }} />
          <span style={{ color: live ? "var(--p-optimal)" : "var(--p-muted)" }}>{live ? "En direct" : "Hors ligne"}</span>
        </span>
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
          title="Pas encore d'activité ce mois"
          subtitle="Tes terrains n'ont pas encore d'activité ce mois. Les données apparaîtront dès la première réservation confirmée."
        />
      ) : (
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
            <p className="text-[11px] mt-1" style={{ color: "var(--p-muted)" }}>Matchs ce mois</p>
          </div>

          <div className="rounded-2xl p-4" style={{ background: "var(--p-surface)", boxShadow: "var(--p-shadow)" }}>
            {multiTerrains ? (
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
                <p className="text-[11px] mt-1" style={{ color: "var(--p-muted)" }}>Réservations confirmées</p>
              </>
            )}
          </div>
        </div>
      )}

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-[14px] font-semibold" style={{ color: "var(--p-text)" }}>Tes gérants ce mois</h2>
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
          <p className="text-sm py-4" style={{ color: "var(--p-muted)" }}>Pas encore assez de données 😊</p>
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
