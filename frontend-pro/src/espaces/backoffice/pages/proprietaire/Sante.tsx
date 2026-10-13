import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { proprietaireApi } from "@/lib/api";
import { useOwnerRealtime } from "@/hooks/useOwnerRealtime";
import ProprioEmptyState from "@/espaces/backoffice/components/ProprioEmptyState";
import {
  activityFilterGroup,
  activityMeta,
  relativeTime,
  scorePhrase,
  scoreTone,
} from "@/espaces/backoffice/proprietaire/proprioUtils";

type Terrain = { id: number; nom: string };
type ReservationNonScannee = {
  id?: number;
  joueur_nom?: string;
  date?: string;
  heure?: string;
  heure_debut?: string;
  code?: string;
  code_reservation?: string;
};
type ActiviteRecente = { action: string; reservation_id?: number; created_at?: string };
type SanteTerrain = {
  score_confiance: number;
  couleur?: "vert" | "orange" | "rouge";
  taux_scan: number;
  matchs_scannes: number;
  total_confirmes: number;
  matchs_non_scannes: number;
  annulations_total: number;
  historique_scores: Array<{ periode: string; score: number }>;
  activite_recente: ActiviteRecente[];
  reservations_non_scannees?: ReservationNonScannee[];
  reservations_non_scannes?: ReservationNonScannee[];
  score_sante_enabled?: boolean;
};

const TONE_COLOR = {
  vert: "var(--p-optimal)",
  orange: "var(--p-attention)",
  rouge: "var(--p-verifier)",
};

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Number(value || 0)));
}

function formatMonth(periode: string) {
  const [year, month] = periode.split("-");
  const date = new Date(Number(year), Number(month || 1) - 1, 1);
  return date.toLocaleDateString("fr-FR", { month: "short" });
}

function formatDate(value?: string) {
  if (!value) return "-";
  return new Date(`${value}T00:00:00`).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
}

function ScoreCircle({ score }: { score: number }) {
  const safe = clampScore(score);
  const radius = 58;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (safe / 100) * circumference;
  const tone = scoreTone(safe);

  return (
    <section className="rounded-2xl p-6 text-center" style={{ background: "var(--p-surface)", boxShadow: "var(--p-shadow)" }}>
      <div className="relative mx-auto h-40 w-40">
        <svg viewBox="0 0 140 140" className="h-full w-full -rotate-90">
          <circle cx="70" cy="70" r={radius} fill="none" stroke="var(--p-surface-2)" strokeWidth="12" />
          <circle
            cx="70"
            cy="70"
            r={radius}
            fill="none"
            stroke={TONE_COLOR[tone]}
            strokeLinecap="round"
            strokeWidth="12"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className="transition-all duration-700 ease-out"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <p className="text-5xl font-bold leading-none" style={{ fontFamily: "var(--font-display)", color: "var(--p-text)" }}>
            {safe}
          </p>
          <p className="text-sm" style={{ color: "var(--p-muted)" }}>/100</p>
        </div>
      </div>
      <p className="mt-4 text-sm font-semibold" style={{ color: "var(--p-text)" }}>
        Score de confiance de ton gérant
      </p>
      <p className="mt-2 text-sm" style={{ color: "var(--p-text-2)" }}>{scorePhrase(safe)}</p>
    </section>
  );
}

export default function SanteProprietaire() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [terrains, setTerrains] = useState<Terrain[]>([]);
  const [selectedTerrainId, setSelectedTerrainId] = useState<string>(searchParams.get("terrain") || "");
  const [health, setHealth] = useState<SanteTerrain | null>(null);
  const [loading, setLoading] = useState(true);
  const [feedFilter, setFeedFilter] = useState<"all" | "scans" | "reservations" | "creneaux">("all");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [freshKeys, setFreshKeys] = useState<Set<string>>(new Set());
  const refreshTimer = useRef<number | null>(null);

  const loadHealth = useCallback(async (terrainId: string, quiet = false) => {
    if (!terrainId) {
      setHealth(null);
      return;
    }
    if (!quiet) setLoading(true);
    try {
      const data = await proprietaireApi.santeTerrain(terrainId);
      setHealth(data);
    } catch {
      setHealth(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    proprietaireApi
      .terrains()
      .then((data: Terrain[]) => {
        if (!mounted) return;
        const list = Array.isArray(data) ? data : [];
        setTerrains(list);
        const fromUrl = searchParams.get("terrain");
        const next = fromUrl && list.some((t) => String(t.id) === fromUrl) ? fromUrl : list[0] ? String(list[0].id) : "";
        setSelectedTerrainId(next);
      })
      .catch(() => {
        if (mounted) setTerrains([]);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [searchParams]);

  useEffect(() => {
    loadHealth(selectedTerrainId);
    setPage(1);
  }, [selectedTerrainId, loadHealth]);

  const scheduleRefresh = useCallback(() => {
    if (!selectedTerrainId) return;
    if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
    refreshTimer.current = window.setTimeout(() => {
      const prev = health?.activite_recente?.[0];
      loadHealth(selectedTerrainId, true).then(() => {
        if (prev) setFreshKeys(new Set([`${prev.action}-${prev.created_at}`]));
      });
    }, 400);
  }, [loadHealth, selectedTerrainId, health]);

  const live = useOwnerRealtime(
    terrains.map((t) => t.id),
    (ev) => {
      if (
        ["reservation", "encaissement", "sante", "score", "statut"].includes(String(ev.type)) &&
        (!ev.terrain_id || String(ev.terrain_id) === selectedTerrainId)
      ) {
        scheduleRefresh();
      }
    },
  );

  useEffect(() => {
    return () => {
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
    };
  }, []);

  const selectedTerrain = terrains.find((terrain) => String(terrain.id) === selectedTerrainId);
  const nonScannees = useMemo(
    () => health?.reservations_non_scannees || health?.reservations_non_scannes || [],
    [health],
  );
  const history = useMemo(
    () => (health?.historique_scores || []).map((item) => ({ ...item, mois: formatMonth(item.periode) })),
    [health],
  );
  const feed = useMemo(() => {
    const rows = health?.activite_recente || [];
    if (feedFilter === "all") return rows;
    return rows.filter((a) => activityFilterGroup(a.action) === feedFilter);
  }, [health, feedFilter]);
  const visibleFeed = feed.slice(0, page * 20);

  if (loading && !health) {
    return (
      <div className="space-y-4 max-w-5xl mx-auto animate-pulse">
        <div className="h-8 w-56 rounded-lg" style={{ background: "var(--p-surface-2)" }} />
        <div className="h-56 rounded-2xl" style={{ background: "var(--p-surface-2)" }} />
      </div>
    );
  }

  if (!terrains.length || !health) {
    return (
      <ProprioEmptyState
        title="Pas encore assez de données 😊"
        subtitle="Le tableau de bord se remplit au fur et à mesure des réservations."
      />
    );
  }

  if (health.score_sante_enabled === false) {
    return (
      <ProprioEmptyState
        title="Score de santé désactivé"
        subtitle="Cette fonctionnalité n’est pas activée pour ce terrain. Contacte l’administration TerrainSN si besoin."
      />
    );
  }

  const scanTone = scoreTone(health.taux_scan);
  const score = clampScore(health.score_confiance);

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      <header className="flex flex-col gap-2">
        <div>
          <h1 className="text-lg font-semibold" style={{ fontFamily: "var(--font-display)", color: "var(--p-text)" }}>
            Santé opérationnelle
          </h1>
          <p className="mt-0.5 text-xs" style={{ color: "var(--p-muted)" }}>Basé sur les 60 derniers jours</p>
        </div>
        {terrains.length > 1 && (
          <div className="overflow-x-auto">
            <div className="flex gap-1.5 min-w-max">
              {terrains.map((terrain) => {
                const active = selectedTerrainId === String(terrain.id);
                return (
                  <button
                    key={terrain.id}
                    type="button"
                    onClick={() => {
                      setSelectedTerrainId(String(terrain.id));
                      setSearchParams({ terrain: String(terrain.id) });
                    }}
                    className="shrink-0 min-h-[36px] px-3 rounded-full text-[11px] font-semibold max-w-[160px] truncate"
                    style={{
                      background: active ? "var(--p-primary)" : "var(--p-surface-2)",
                      color: active ? "#fff" : "var(--p-muted)",
                    }}
                  >
                    {terrain.nom}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </header>

      {selectedTerrain && (
        <p className="text-sm font-semibold" style={{ color: "var(--p-primary)" }}>{selectedTerrain.nom}</p>
      )}

      <ScoreCircle score={score} />

      <section className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <article className="rounded-2xl p-4" style={{ background: "var(--p-surface)", boxShadow: "var(--p-shadow)" }}>
          <p className="text-xs" style={{ color: "var(--p-muted)" }}>Matchs validés</p>
          <p className="mt-2 text-2xl font-bold" style={{ fontFamily: "var(--font-display)", color: "var(--p-text)" }}>
            {health.matchs_scannes} sur {health.total_confirmes}
          </p>
          <p className="mt-1 text-xs" style={{ color: "var(--p-muted)" }}>Matchs scannés ce mois</p>
          <div className="mt-4 h-2 rounded-full overflow-hidden" style={{ background: "var(--p-surface-2)" }}>
            <div className="h-full" style={{ width: `${clampScore(health.taux_scan)}%`, background: TONE_COLOR[scanTone] }} />
          </div>
        </article>

        <article className="rounded-2xl p-4" style={{ background: "var(--p-surface)", boxShadow: "var(--p-shadow)" }}>
          <p className="text-xs" style={{ color: "var(--p-muted)" }}>Matchs non scannés</p>
          <p className="mt-2 text-2xl font-bold" style={{ fontFamily: "var(--font-display)", color: health.matchs_non_scannes > 0 ? "var(--p-attention)" : "var(--p-optimal)" }}>
            {health.matchs_non_scannes}
          </p>
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            className="mt-4 w-full min-h-[44px] rounded-xl text-sm font-semibold border"
            style={{ borderColor: "var(--p-border)", color: "var(--p-text)" }}
          >
            Voir la liste
          </button>
        </article>

        <article className="rounded-2xl p-4" style={{ background: "var(--p-surface)", boxShadow: "var(--p-shadow)" }}>
          <p className="text-xs" style={{ color: "var(--p-muted)" }}>Annulations</p>
          <p className="mt-2 text-2xl font-bold" style={{ fontFamily: "var(--font-display)", color: "var(--p-muted)" }}>
            {health.annulations_total}
          </p>
          <p className="mt-1 text-xs" style={{ color: "var(--p-muted)" }}>Sur les 60 derniers jours</p>
        </article>
      </section>

      <section className="rounded-2xl p-4" style={{ background: "var(--p-surface)", boxShadow: "var(--p-shadow)" }}>
        <h2 className="text-sm font-semibold" style={{ color: "var(--p-text)" }}>Évolution du score</h2>
        <div className="mt-4 h-64">
          {history.length < 2 ? (
            <div className="h-full flex items-center justify-center text-sm text-center px-4" style={{ color: "var(--p-text-2)" }}>
              Le graphique sera disponible après 2 mois d'activité 😊
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={history} margin={{ left: -24, right: 8, top: 12, bottom: 0 }}>
                <XAxis dataKey="mois" tickLine={false} axisLine={false} fontSize={12} tick={{ fill: "var(--p-muted)" }} />
                <YAxis domain={[0, 100]} tickLine={false} axisLine={false} fontSize={12} tick={{ fill: "var(--p-muted)" }} />
                <Tooltip formatter={(value) => [`${value} / 100`, "Score"]} labelFormatter={(label) => `Mois : ${label}`} />
                <Bar dataKey="score" radius={[8, 8, 0, 0]}>
                  {history.map((entry) => (
                    <Cell key={entry.periode} fill={TONE_COLOR[scoreTone(entry.score)]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </section>

      <section className="rounded-2xl p-4" style={{ background: "var(--p-surface)", boxShadow: "var(--p-shadow)" }}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold" style={{ color: "var(--p-text)" }}>Ce que fait ton gérant</h2>
            <p className="text-[11px] mt-0.5 inline-flex items-center gap-1.5" style={{ color: "var(--p-muted)" }}>
              Activité en temps réel
              <span className={`w-1.5 h-1.5 rounded-full ${live ? "animate-pulse" : ""}`} style={{ background: live ? "var(--p-live)" : "var(--p-verifier)" }} />
            </p>
          </div>
        </div>
        <div className="mt-3 flex gap-1.5 overflow-x-auto">
          {([
            ["all", "Tout"],
            ["scans", "Scans QR"],
            ["reservations", "Réservations"],
            ["creneaux", "Créneaux"],
          ] as const).map(([id, label]) => {
            const active = feedFilter === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setFeedFilter(id);
                  setPage(1);
                }}
                className="shrink-0 min-h-[36px] px-3 rounded-full text-[11px] font-semibold"
                style={{
                  background: active ? "var(--p-primary)" : "var(--p-surface-2)",
                  color: active ? "#fff" : "var(--p-muted)",
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
        <div className="mt-3 divide-y" style={{ borderColor: "var(--p-border)" }}>
          {visibleFeed.length === 0 ? (
            <p className="py-8 text-center text-sm" style={{ color: "var(--p-text-2)" }}>Pas encore assez de données</p>
          ) : (
            visibleFeed.map((activity, index) => {
              const meta = activityMeta(activity.action);
              const key = `${activity.action}-${activity.created_at}-${index}`;
              const fresh = freshKeys.has(`${activity.action}-${activity.created_at}`);
              return (
                <div key={key} className={`py-3 flex items-center gap-3 ${fresh ? "p-fade-slide-down" : ""}`}>
                  <span className="h-9 w-9 rounded-full inline-flex items-center justify-center" style={{ background: "var(--p-surface-2)" }}>
                    <meta.Icon className="h-4 w-4" style={{ color: meta.color }} />
                  </span>
                  <p className="flex-1 min-w-0 text-sm font-medium" style={{ color: "var(--p-text)" }}>{meta.label}</p>
                  <p className="text-xs" style={{ color: "var(--p-muted)" }}>{relativeTime(activity.created_at)}</p>
                </div>
              );
            })
          )}
        </div>
        {visibleFeed.length < feed.length && (
          <button
            type="button"
            onClick={() => setPage((n) => n + 1)}
            className="w-full min-h-[44px] mt-2 rounded-xl text-sm font-semibold"
            style={{ background: "var(--p-surface-2)", color: "var(--p-primary)" }}
          >
            Voir plus
          </button>
        )}
      </section>

      {sheetOpen && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center">
          <button type="button" className="absolute inset-0 bg-black/40" aria-label="Fermer" onClick={() => setSheetOpen(false)} />
          <div
            className="relative w-full max-w-lg rounded-t-2xl md:rounded-2xl p-4 max-h-[70vh] overflow-auto"
            style={{ background: "var(--p-surface)" }}
          >
            <h3 className="text-sm font-semibold" style={{ color: "var(--p-text)" }}>Réservations en attente de validation</h3>
            <div className="mt-3 space-y-2">
              {nonScannees.length === 0 ? (
                <p className="text-sm" style={{ color: "var(--p-text-2)" }}>Aucune réservation en attente.</p>
              ) : (
                nonScannees.map((reservation, index) => (
                  <div key={reservation.id || index} className="rounded-xl p-3 text-sm" style={{ border: "1px solid var(--p-border)" }}>
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-semibold" style={{ color: "var(--p-text)" }}>{reservation.joueur_nom || "Joueur"}</p>
                      <p className="text-xs" style={{ color: "var(--p-muted)" }}>{reservation.code || reservation.code_reservation || "-"}</p>
                    </div>
                    <p className="mt-1 text-xs" style={{ color: "var(--p-text-2)" }}>
                      {formatDate(reservation.date)} · {String(reservation.heure || reservation.heure_debut || "-").slice(0, 5)}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
