import { AlertTriangle, CheckCircle2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

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

const colorClasses = {
  vert: "bg-[var(--color-success)]",
  orange: "bg-[var(--color-warning)]",
  rouge: "bg-[var(--color-danger)]",
};

const textClasses = {
  vert: "text-[var(--color-success)]",
  orange: "text-[var(--color-warning)]",
  rouge: "text-[var(--color-danger)]",
};

function ProgressLine({ value, color }: { value: number; color: SanteTerrain["couleur"] }) {
  const safeValue = Math.max(0, Math.min(100, Number(value || 0)));
  return (
    <div className="h-2 rounded-full bg-[var(--color-surface-2)] overflow-hidden">
      <div className={`h-full ${colorClasses[color]}`} style={{ width: `${safeValue}%` }} />
    </div>
  );
}

export default function SanteTerrainCard({
  terrainNom,
  sante,
  onVoirDetail,
}: {
  terrainNom: string;
  sante: SanteTerrain;
  onVoirDetail?: () => void;
}) {
  const score = Number(sante.score_confiance || 0);
  const comment =
    score > 75 ? "" : score >= 50 ? "Pense a en parler avec ton gerant" : "Contacte ton gerant";

  return (
    <section className="bg-white rounded-[var(--radius-md)] border border-[var(--color-border)] p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="section-title">Sante de ton terrain ce mois</h2>
          <p className="text-xs text-[var(--color-text-muted)] mt-1">Mis a jour automatiquement</p>
        </div>
        <div className="w-9 h-9 rounded-full bg-[color-mix(in_srgb,var(--color-primary)_12%,white)] inline-flex items-center justify-center">
          <ShieldCheck className="w-4 h-4 text-[var(--color-primary)]" />
        </div>
      </div>

      <p className="mt-3 text-sm font-semibold text-[var(--color-text-primary)]">{terrainNom}</p>

      <div className="mt-4 space-y-4">
        <div>
          <div className="flex items-center justify-between text-xs mb-2">
            <span className="text-[var(--color-text-secondary)]">Matchs valides</span>
            <span className="font-semibold text-[var(--color-text-primary)]">
              {sante.matchs_scannes} sur {sante.total_confirmes} matchs
            </span>
          </div>
          <ProgressLine value={sante.taux_scan} color={sante.taux_scan > 75 ? "vert" : sante.taux_scan >= 50 ? "orange" : "rouge"} />
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-[var(--color-border)] pt-3">
          <div>
            <p className="text-xs text-[var(--color-text-secondary)]">En attente de validation</p>
            <p className={`text-lg font-bold ${sante.matchs_non_scannes > 0 ? "text-[var(--color-warning)]" : "text-[var(--color-success)]"}`}>
              {sante.matchs_non_scannes}
            </p>
          </div>
          {sante.matchs_non_scannes > 0 ? (
            <Button type="button" variant="outline" size="sm" onClick={onVoirDetail}>
              Voir le detail
            </Button>
          ) : (
            <CheckCircle2 className="w-5 h-5 text-[var(--color-success)]" />
          )}
        </div>

        <div className="border-t border-[var(--color-border)] pt-3">
          <div className="flex items-center justify-between text-xs mb-2">
            <span className="text-[var(--color-text-secondary)]">Score de confiance gerant</span>
            <span className={`font-bold ${textClasses[sante.couleur]}`}>{score} / 100</span>
          </div>
          <ProgressLine value={score} color={sante.couleur} />
          {comment && (
            <p className={`mt-2 text-xs inline-flex items-center gap-1 ${textClasses[sante.couleur]}`}>
              <AlertTriangle className="w-3.5 h-3.5" />
              {comment}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
