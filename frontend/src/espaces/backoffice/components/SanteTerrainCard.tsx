import { AlertTriangle, ChevronRight } from "lucide-react";

type ReservationNonScannee = {
  id: number;
  joueur_nom?: string;
  date?: string;
  heure_debut?: string;
  heure_fin?: string;
  code_reservation?: string;
};

type SanteTerrain = {
  taux_scan: number;
  matchs_scannes: number;
  total_confirmes: number;
  matchs_non_scannes: number;
  score_confiance: number;
  couleur: "vert" | "orange" | "rouge";
  reservations_non_scannes?: ReservationNonScannee[];
};

const badgeByCouleur = {
  vert: {
    label: "Optimal",
    className:
      "bg-[color-mix(in_srgb,var(--color-success)_14%,white)] text-[var(--color-success)]",
  },
  orange: {
    label: "Attention",
    className:
      "bg-[color-mix(in_srgb,var(--color-warning)_16%,white)] text-[var(--color-warning)]",
  },
  rouge: {
    label: "À vérifier",
    className:
      "bg-[color-mix(in_srgb,var(--color-danger)_12%,white)] text-[var(--color-danger)]",
  },
} as const;

const barByCouleur = {
  vert: "bg-[var(--color-success)]",
  orange: "bg-[var(--color-warning)]",
  rouge: "bg-[var(--color-danger)]",
} as const;

function MiniGauge({ value, color }: { value: number; color: SanteTerrain["couleur"] }) {
  const safe = Math.max(0, Math.min(100, Number(value || 0)));
  const barClass = barByCouleur[color] || barByCouleur.orange;
  return (
    <div className="flex items-center gap-2 min-w-[88px]">
      <div className="flex-1 h-1.5 rounded-full bg-[var(--color-surface-2)] overflow-hidden">
        <div className={`h-full ${barClass}`} style={{ width: `${safe}%` }} />
      </div>
      <span className="text-[11px] font-semibold tabular-nums text-[var(--color-text-primary)] w-9 text-right">
        {safe}
        <span className="text-[var(--color-text-muted)] font-medium">/100</span>
      </span>
    </div>
  );
}

export default function SanteTerrainCard({
  terrainNom,
  sante,
  onVoirDetail,
  compact = false,
  ultra = false,
}: {
  terrainNom: string;
  sante: SanteTerrain;
  onVoirDetail?: () => void;
  compact?: boolean;
  ultra?: boolean;
}) {
  const score = Number(sante.score_confiance || 0);
  const couleur = (sante.couleur || (score > 75 ? "vert" : score >= 50 ? "orange" : "rouge")) as SanteTerrain["couleur"];
  const badge = badgeByCouleur[couleur] || badgeByCouleur.orange;
  const tauxScan = Number(sante.taux_scan || 0);
  const scanColor: SanteTerrain["couleur"] =
    tauxScan > 75 ? "vert" : tauxScan >= 50 ? "orange" : "rouge";

  if (ultra) {
    return (
      <button
        type="button"
        onClick={onVoirDetail}
        className="w-full text-left bg-white rounded-[var(--radius-sm)] border border-[var(--color-border)] px-2.5 py-1.5 flex items-center gap-2"
      >
        <div className="min-w-0 flex-1 flex items-center gap-2">
          <p
            className="text-xs font-semibold truncate text-[var(--color-text-primary)]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {terrainNom}
          </p>
          <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 ${badge.className}`}>
            {badge.label}
          </span>
        </div>
        <span className="text-[10px] tabular-nums text-[var(--color-text-muted)] shrink-0">
          {sante.matchs_scannes}/{sante.total_confirmes}
        </span>
        <span className={`text-[11px] font-bold tabular-nums shrink-0 ${
          couleur === "vert"
            ? "text-[var(--color-success)]"
            : couleur === "orange"
              ? "text-[var(--color-warning)]"
              : "text-[var(--color-danger)]"
        }`}>
          {score}
        </span>
        <ChevronRight className="w-3.5 h-3.5 text-[var(--color-text-muted)] shrink-0" />
      </button>
    );
  }

  if (compact) {
    return (
      <button
        type="button"
        onClick={onVoirDetail}
        className="w-full text-left bg-white rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 py-2.5 hover:bg-[var(--color-surface-2)]/40 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <p
                className="text-sm font-semibold truncate text-[var(--color-text-primary)]"
                style={{ fontFamily: "var(--font-display)" }}
              >
                {terrainNom}
              </p>
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${badge.className}`}>
                {badge.label}
              </span>
            </div>
            <div className="mt-2 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between text-[10px] mb-1">
                  <span className="text-[var(--color-text-muted)]">Matchs validés</span>
                  <span className="font-medium text-[var(--color-text-secondary)]">
                    {sante.matchs_scannes}/{sante.total_confirmes}
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-[var(--color-surface-2)] overflow-hidden">
                  <div
                    className={`h-full ${barByCouleur[scanColor]}`}
                    style={{ width: `${Math.max(0, Math.min(100, tauxScan))}%` }}
                  />
                </div>
              </div>
              <div className="shrink-0">
                <p className="text-[10px] text-[var(--color-text-muted)] mb-1">Confiance</p>
                <MiniGauge value={score} color={couleur} />
              </div>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-[var(--color-text-muted)] shrink-0" />
        </div>
      </button>
    );
  }

  return (
    <section className="bg-white rounded-[var(--radius-md)] border border-[var(--color-border)] p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p
              className="text-sm font-semibold text-[var(--color-text-primary)] truncate"
              style={{ fontFamily: "var(--font-display)" }}
            >
              {terrainNom}
            </p>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${badge.className}`}>
              {badge.label}
            </span>
          </div>
          <p className="text-xs text-[var(--color-text-muted)] mt-1">Mis à jour automatiquement</p>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <div>
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="text-[var(--color-text-secondary)]">Matchs validés</span>
            <span className="font-semibold text-[var(--color-text-primary)]">
              {sante.matchs_scannes} / {sante.total_confirmes}
            </span>
          </div>
          <div className="h-2 rounded-full bg-[var(--color-surface-2)] overflow-hidden">
            <div
              className={`h-full ${barByCouleur[scanColor]}`}
              style={{ width: `${Math.max(0, Math.min(100, tauxScan))}%` }}
            />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="text-[var(--color-text-secondary)]">Score de confiance gérant</span>
            <span className="font-bold tabular-nums">{score}/100</span>
          </div>
          <MiniGauge value={score} color={couleur} />
          {score < 75 && (
            <p className="mt-2 text-xs inline-flex items-center gap-1 text-[var(--color-warning)]">
              <AlertTriangle className="w-3.5 h-3.5" />
              {score >= 50 ? "Parlez-en avec votre gérant" : "Contactez votre gérant"}
            </p>
          )}
        </div>

        {onVoirDetail && (
          <button
            type="button"
            onClick={onVoirDetail}
            className="text-xs font-medium text-[var(--color-primary)] inline-flex items-center gap-1"
          >
            Voir le détail <ChevronRight className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </section>
  );
}
