import { ChevronRight } from "lucide-react";
import { gerantPrenom, scoreTone } from "@/espaces/backoffice/proprietaire/proprioUtils";

type Props = {
  terrainNom?: string;
  gerant?: { prenom?: string; nom?: string } | null;
  score?: number;
  matchsScannes?: number;
  totalConfirmes?: number;
  onClick?: () => void;
};

export function SanteGerantCondensee({
  terrainNom,
  gerant,
  score = 0,
  matchsScannes = 0,
  totalConfirmes = 0,
  onClick,
}: Props) {
  const tone = scoreTone(Number(score || 0));
  const badge =
    tone === "vert"
      ? { label: "Optimal ✓", bg: "var(--p-optimal-bg)", color: "var(--p-optimal)" }
      : tone === "orange"
        ? { label: "Attention", bg: "var(--p-attention-bg)", color: "var(--p-attention)" }
        : { label: "À vérifier", bg: "var(--p-verifier-bg)", color: "var(--p-verifier)" };

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left rounded-2xl px-4 py-3.5 flex items-center gap-3 btn-press"
      style={{
        background: "var(--p-surface)",
        border: "1px solid var(--p-border)",
        boxShadow: "var(--p-shadow)",
      }}
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold truncate" style={{ color: "var(--p-text)" }}>
          {gerantPrenom(gerant) || "Aucun gérant"}
          {terrainNom ? (
            <span className="font-normal" style={{ color: "var(--p-muted)" }}>
              {" "}· {terrainNom}
            </span>
          ) : null}
        </p>
        <p className="text-xs mt-0.5" style={{ color: "var(--p-muted)" }}>
          {matchsScannes}/{totalConfirmes} matchs validés · Score {Math.round(score)}/100
        </p>
      </div>
      <span
        className="text-[11px] font-semibold px-2.5 py-1 rounded-full shrink-0"
        style={{ background: badge.bg, color: badge.color }}
      >
        {badge.label}
      </span>
      <ChevronRight className="w-4 h-4 shrink-0" style={{ color: "var(--p-muted)" }} />
    </button>
  );
}

export default SanteGerantCondensee;
