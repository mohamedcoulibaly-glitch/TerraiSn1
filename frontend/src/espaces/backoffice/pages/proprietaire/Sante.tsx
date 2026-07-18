import { useEffect, useMemo, useState } from "react";
import {
  Calendar,
  CheckCircle2,
  PlusCircle,
  ShieldCheck,
  Trash2,
  XCircle,
} from "lucide-react";
import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { proprietaireApi } from "@/lib/api";

type Terrain = {
  id: number;
  nom: string;
};

type ReservationNonScannee = {
  id?: number;
  joueur_nom?: string;
  date?: string;
  heure?: string;
  heure_debut?: string;
  code?: string;
  code_reservation?: string;
};

type HistoriqueScore = {
  periode: string;
  score: number;
};

type ActiviteRecente = {
  action: string;
  reservation_id?: number;
  created_at?: string;
};

type SanteTerrain = {
  score_confiance: number;
  couleur: "vert" | "orange" | "rouge";
  taux_scan: number;
  matchs_scannes: number;
  total_confirmes: number;
  matchs_non_scannes: number;
  annulations_total: number;
  historique_scores: HistoriqueScore[];
  activite_recente: ActiviteRecente[];
  reservations_non_scannees?: ReservationNonScannee[];
  reservations_non_scannes?: ReservationNonScannee[];
};

const COLORS = {
  vert: "var(--color-success)",
  orange: "var(--color-warning)",
  rouge: "var(--color-danger)",
  neutre: "var(--color-text-muted)",
};

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Number(value || 0)));
}

function scoreTone(score: number): SanteTerrain["couleur"] {
  if (score > 75) return "vert";
  if (score >= 50) return "orange";
  return "rouge";
}

function colorForScore(score: number) {
  return COLORS[scoreTone(score)];
}

function scorePhrase(color: SanteTerrain["couleur"]) {
  if (color === "vert") return "Tout va bien 👍";
  if (color === "orange") return "Pense à en parler avec ton gérant 😊";
  return "On te conseille de contacter ton gérant";
}

function formatMonth(periode: string) {
  const [year, month] = periode.split("-");
  const date = new Date(Number(year), Number(month || 1) - 1, 1);
  return date.toLocaleDateString("fr-FR", { month: "short" });
}

function formatDate(value?: string) {
  if (!value) return "-";
  return new Date(`${value}T00:00:00`).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
  });
}

function formatDateTime(value?: string) {
  if (!value) return "-";
  return new Date(value).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function activityMeta(action: string) {
  if (action === "reservation_creee") {
    return { label: "Réservation créée", Icon: Calendar, color: "text-[var(--color-success)]" };
  }
  if (action === "reservation_annulee") {
    return { label: "Réservation annulée", Icon: XCircle, color: "text-[var(--color-warning)]" };
  }
  if (action === "qr_scanne") {
    return { label: "Match validé ✅", Icon: CheckCircle2, color: "text-[var(--color-success)]" };
  }
  if (action === "creneau_cree") {
    return { label: "Créneau ajouté", Icon: PlusCircle, color: "text-[var(--color-info)]" };
  }
  if (action === "creneau_supprime") {
    return { label: "Créneau supprimé", Icon: Trash2, color: "text-[var(--color-warning)]" };
  }
  return { label: "Activité mise à jour", Icon: ShieldCheck, color: "text-[var(--color-primary)]" };
}

function ScoreCircle({ health }: { health: SanteTerrain }) {
  const score = clampScore(health.score_confiance);
  const radius = 58;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  return (
    <section className="bg-white rounded-[var(--radius-lg)] border border-[var(--color-border)] p-6 shadow-sm text-center">
      <div className="relative mx-auto h-40 w-40">
        <svg viewBox="0 0 140 140" className="h-full w-full -rotate-90">
          <circle
            cx="70"
            cy="70"
            r={radius}
            fill="none"
            stroke="var(--color-surface-2)"
            strokeWidth="12"
          />
          <circle
            cx="70"
            cy="70"
            r={radius}
            fill="none"
            stroke={COLORS[health.couleur]}
            strokeLinecap="round"
            strokeWidth="12"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className="transition-all duration-700 ease-out"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <p
            className="text-5xl font-bold text-[var(--color-text-primary)] leading-none"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {score}
          </p>
          <p className="text-sm text-[var(--color-text-muted)]">/ 100</p>
        </div>
      </div>
      <p className="mt-4 text-sm font-semibold text-[var(--color-text-primary)]">
        Score de confiance de ton gérant
      </p>
      <p className="mt-2 text-sm text-[var(--color-text-secondary)]">{scorePhrase(health.couleur)}</p>
    </section>
  );
}

function StatCard({
  title,
  value,
  subtitle,
  color = "var(--color-text-primary)",
  children,
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  color?: string;
  children?: React.ReactNode;
}) {
  return (
    <article className="bg-white rounded-[var(--radius-md)] border border-[var(--color-border)] p-4 shadow-sm">
      <p className="text-xs text-[var(--color-text-secondary)]">{title}</p>
      <p
        className="mt-2 text-3xl font-bold"
        style={{ color, fontFamily: "var(--font-display)" }}
      >
        {value}
      </p>
      {subtitle && <p className="mt-1 text-xs text-[var(--color-text-muted)]">{subtitle}</p>}
      {children}
    </article>
  );
}

function LoadingState() {
  return (
    <div className="space-y-5 max-w-5xl mx-auto">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-10 w-44" />
      </div>
      <Skeleton className="h-72 w-full rounded-[var(--radius-lg)]" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Skeleton className="h-32 rounded-[var(--radius-md)]" />
        <Skeleton className="h-32 rounded-[var(--radius-md)]" />
        <Skeleton className="h-32 rounded-[var(--radius-md)]" />
      </div>
      <Skeleton className="h-72 rounded-[var(--radius-md)]" />
      <Skeleton className="h-56 rounded-[var(--radius-md)]" />
    </div>
  );
}

export default function SanteProprietaire() {
  const [terrains, setTerrains] = useState<Terrain[]>([]);
  const [selectedTerrainId, setSelectedTerrainId] = useState<string>("");
  const [health, setHealth] = useState<SanteTerrain | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    proprietaireApi
      .terrains()
      .then((data: Terrain[]) => {
        if (!mounted) return;
        setTerrains(data || []);
        if (data?.length) setSelectedTerrainId(String(data[0].id));
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedTerrainId) {
      setHealth(null);
      return;
    }
    let mounted = true;
    setLoading(true);
    proprietaireApi
      .santeTerrain(selectedTerrainId)
      .then((data: SanteTerrain) => {
        if (mounted) setHealth(data);
      })
      .catch(() => {
        if (mounted) setHealth(null);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [selectedTerrainId]);

  const selectedTerrain = terrains.find((terrain) => String(terrain.id) === selectedTerrainId);
  const nonScannees = useMemo(
    () => health?.reservations_non_scannees || health?.reservations_non_scannes || [],
    [health]
  );
  const history = useMemo(
    () => (health?.historique_scores || []).map((item) => ({ ...item, mois: formatMonth(item.periode) })),
    [health]
  );

  if (loading && !health) return <LoadingState />;

  if (!terrains.length) {
    return (
      <div className="max-w-xl mx-auto py-16 text-center">
        <div className="mx-auto h-16 w-16 rounded-full bg-[color-mix(in_srgb,var(--color-primary)_12%,white)] flex items-center justify-center">
          <ShieldCheck className="h-7 w-7 text-[var(--color-primary)]" />
        </div>
        <h1 className="mt-4 text-xl font-bold" style={{ fontFamily: "var(--font-display)" }}>
          Pas encore assez de données 😊
        </h1>
        <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
          Le tableau de bord se remplit au fur et à mesure des réservations.
        </p>
      </div>
    );
  }

  if (!health) {
    return (
      <div className="max-w-xl mx-auto py-16 text-center">
        <div className="mx-auto h-16 w-16 rounded-full bg-[color-mix(in_srgb,var(--color-primary)_12%,white)] flex items-center justify-center">
          <ShieldCheck className="h-7 w-7 text-[var(--color-primary)]" />
        </div>
        <h1 className="mt-4 text-xl font-bold" style={{ fontFamily: "var(--font-display)" }}>
          Pas encore assez de données 😊
        </h1>
        <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
          Le tableau de bord se remplit au fur et à mesure des réservations.
        </p>
      </div>
    );
  }

  const tauxColor = colorForScore(health.taux_scan);

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1
            className="text-2xl font-bold text-[var(--color-text-primary)]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Santé de ton terrain
          </h1>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            Mis à jour automatiquement chaque semaine
          </p>
        </div>
        {terrains.length > 1 && (
          <select
            value={selectedTerrainId}
            onChange={(event) => setSelectedTerrainId(event.target.value)}
            className="min-h-[44px] rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-white px-3 text-sm"
            aria-label="Choisir un terrain"
          >
            {terrains.map((terrain) => (
              <option key={terrain.id} value={terrain.id}>
                {terrain.nom}
              </option>
            ))}
          </select>
        )}
      </header>

      {selectedTerrain && (
        <p className="text-sm font-semibold text-[var(--color-primary)]">{selectedTerrain.nom}</p>
      )}

      <ScoreCircle health={health} />

      <section className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <StatCard
          title="Matchs validés"
          value={`${health.matchs_scannes} sur ${health.total_confirmes}`}
          subtitle="Matchs scannés ce mois"
        >
          <div className="mt-4 h-2 rounded-full bg-[var(--color-surface-2)] overflow-hidden">
            <div
              className="h-full transition-all duration-500"
              style={{ width: `${clampScore(health.taux_scan)}%`, backgroundColor: tauxColor }}
            />
          </div>
        </StatCard>

        <StatCard
          title="Matchs non scannés"
          value={health.matchs_non_scannes}
          color={health.matchs_non_scannes > 0 ? COLORS.orange : COLORS.vert}
          subtitle="Matchs confirmés mais pas encore joués"
        >
          <Dialog>
            <DialogTrigger asChild>
              <Button type="button" variant="outline" className="mt-4 w-full">
                Voir le détail
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Réservations en attente de validation</DialogTitle>
              </DialogHeader>
              <div className="mt-2 max-h-[60vh] overflow-auto space-y-2">
                {nonScannees.length === 0 ? (
                  <p className="text-sm text-[var(--color-text-secondary)]">Aucune réservation en attente.</p>
                ) : (
                  nonScannees.map((reservation, index) => (
                    <div
                      key={reservation.id || index}
                      className="rounded-[var(--radius-sm)] border border-[var(--color-border)] p-3 text-sm"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-semibold text-[var(--color-text-primary)]">
                          {reservation.joueur_nom || "Joueur"}
                        </p>
                        <p className="text-xs text-[var(--color-text-muted)]">
                          {reservation.code || reservation.code_reservation || "-"}
                        </p>
                      </div>
                      <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
                        {formatDate(reservation.date)} · {String(reservation.heure || reservation.heure_debut || "-").slice(0, 5)}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </DialogContent>
          </Dialog>
        </StatCard>

        <StatCard
          title="Annulations ce mois"
          value={health.annulations_total}
          color={COLORS.neutre}
          subtitle="Sur les 60 derniers jours"
        />
      </section>

      <section className="bg-white rounded-[var(--radius-md)] border border-[var(--color-border)] p-4 shadow-sm">
        <h2 className="section-title">Évolution du score</h2>
        <div className="mt-4 h-72">
          {history.length === 0 ? (
            <div className="h-full flex items-center justify-center text-sm text-[var(--color-text-secondary)]">
              Pas encore assez de données 😊
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={history} margin={{ left: -24, right: 8, top: 12, bottom: 0 }}>
                <XAxis dataKey="mois" tickLine={false} axisLine={false} fontSize={12} />
                <YAxis domain={[0, 100]} tickLine={false} axisLine={false} fontSize={12} />
                <Tooltip
                  cursor={{ fill: "var(--color-surface-2)" }}
                  formatter={(value) => [`${value} / 100`, "Score"]}
                  labelFormatter={(label) => `Mois : ${label}`}
                />
                <Bar dataKey="score" radius={[8, 8, 0, 0]}>
                  {history.map((entry) => (
                    <Cell key={entry.periode} fill={colorForScore(entry.score)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </section>

      <section className="bg-white rounded-[var(--radius-md)] border border-[var(--color-border)] p-4 shadow-sm">
        <h2 className="section-title">Activité récente de ton gérant</h2>
        <div className="mt-4 divide-y divide-[var(--color-border)]">
          {health.activite_recente.length === 0 ? (
            <p className="py-8 text-center text-sm text-[var(--color-text-secondary)]">
              Pas encore assez de données 😊
            </p>
          ) : (
            health.activite_recente.map((activity, index) => {
              const meta = activityMeta(activity.action);
              return (
                <div key={`${activity.action}-${activity.created_at}-${index}`} className="py-3 flex items-center gap-3">
                  <span className="h-9 w-9 rounded-full bg-[var(--color-surface-2)] inline-flex items-center justify-center">
                    <meta.Icon className={`h-4 w-4 ${meta.color}`} />
                  </span>
                  <p className="flex-1 min-w-0 text-sm font-medium text-[var(--color-text-primary)]">
                    {meta.label}
                  </p>
                  <p className="text-xs text-[var(--color-text-muted)]">
                    {formatDateTime(activity.created_at)}
                  </p>
                </div>
              );
            })
          )}
        </div>
        <Button type="button" variant="outline" className="mt-4 w-full" disabled={health.activite_recente.length === 0}>
          Voir tout l'historique
        </Button>
      </section>
    </div>
  );
}
