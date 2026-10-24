import { ChevronRight } from "lucide-react";
import { formaterMontantCompact } from "./KpiMontantWave";
import { proprioTerrainPhoto, scoreTone } from "@/espaces/backoffice/proprietaire/proprioUtils";

export type TerrainCardProprioData = {
  id: number;
  nom: string;
  adresse?: string;
  ville?: string;
  quartier?: string;
  photos?: unknown;
  photo_principale?: string | null;
  is_active?: number | boolean;
  actif?: number | boolean;
  ca_mois?: number;
  score_sante?: number;
};

function getSanteColor(score?: number) {
  const tone = scoreTone(Number(score || 0));
  if (tone === "vert") return "var(--p-optimal)";
  if (tone === "orange") return "var(--p-attention)";
  return "var(--p-verifier)";
}

export function TerrainCardProprio({
  terrain,
  onClick,
}: {
  terrain: TerrainCardProprioData;
  onClick?: () => void;
}) {
  const ouvert = terrain.actif != null
    ? Number(terrain.actif) !== 0
    : terrain.is_active != null
      ? Number(terrain.is_active) !== 0
      : true;
  const photo = terrain.photo_principale || proprioTerrainPhoto(terrain);
  const quartier = terrain.quartier || terrain.adresse || terrain.ville || "";

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-4 p-4 rounded-2xl mb-2 btn-press text-left"
      style={{
        background: "var(--p-surface)",
        border: "1px solid var(--p-border)",
        boxShadow: "var(--p-shadow)",
      }}
    >
      <div className="w-14 h-14 rounded-xl overflow-hidden shrink-0" style={{ background: "var(--p-surface-2)" }}>
        <img src={photo} alt={terrain.nom} className="w-full h-full object-cover" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="font-semibold text-sm truncate" style={{ color: "var(--p-text)" }}>
            {terrain.nom}
          </p>
          <span
            className="text-xs px-2 py-0.5 rounded-full shrink-0"
            style={{
              background: ouvert ? "var(--p-optimal-bg)" : "var(--p-surface-2)",
              color: ouvert ? "var(--p-optimal)" : "var(--p-muted)",
            }}
          >
            {ouvert ? "Ouvert" : "Fermé"}
          </span>
        </div>
        {quartier ? (
          <p className="text-xs mt-0.5" style={{ color: "var(--p-muted)" }}>
            {quartier}
          </p>
        ) : null}
        <div className="flex items-center gap-3 mt-1.5 flex-wrap">
          <span className="text-xs font-bold" style={{ color: "var(--p-text)" }}>
            {formaterMontantCompact(Number(terrain.ca_mois || 0))} FCFA
          </span>
          <span className="text-xs" style={{ color: "var(--p-muted)" }}>
            ce mois
          </span>
          {terrain.score_sante != null ? (
            <span className="text-xs" style={{ color: getSanteColor(terrain.score_sante) }}>
              Score {Math.round(Number(terrain.score_sante))}/100
            </span>
          ) : null}
        </div>
      </div>

      <ChevronRight className="w-4 h-4 shrink-0" style={{ color: "var(--p-muted)" }} />
    </button>
  );
}

export default TerrainCardProprio;
