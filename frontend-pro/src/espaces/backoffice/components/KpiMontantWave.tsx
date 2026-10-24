import type { ElementType } from "react";
import { TrendingDown, TrendingUp } from "lucide-react";

export type KpiMontantWaveFormat = "montant" | "nombre" | "pourcent";

export interface KpiMontantWaveProps {
  label: string;
  montant: number;
  delta?: number;
  couleur?: string;
  icone: ElementType;
  souslabel?: string;
  cliquable?: boolean;
  onClick?: () => void;
  taille?: "hero" | "normal" | "petit";
  /** montant = FCFA (défaut), nombre = entier brut, pourcent = % */
  format?: KpiMontantWaveFormat;
  /** Variables CSS surface/bordure/texte — gérant ou proprio */
  surfaceVar?: string;
  borderVar?: string;
  textVar?: string;
  mutedVar?: string;
  shadowVar?: string;
  dangerVar?: string;
}

export function formaterMontantSansDevise(n: number): string {
  return Math.round(Number(n) || 0).toLocaleString("fr-FR");
}

export function formaterMontantCompact(n: number): string {
  const v = Math.round(Number(n) || 0);
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${Math.round(v / 1_000)}K`;
  return String(v);
}

export function formaterMontant(n: number): string {
  return `${formaterMontantSansDevise(n)} FCFA`;
}

/**
 * KPI style Wave — partagé gérant (--g-*) et propriétaire (--p-*).
 * Passer la couleur d'accent en prop ; le net vient toujours du backend.
 */
export function KpiMontantWave({
  label,
  montant,
  delta,
  couleur = "var(--g-primary)",
  icone: Icone,
  souslabel,
  cliquable,
  onClick,
  taille = "normal",
  format = "montant",
  surfaceVar = "var(--g-surface)",
  borderVar = "var(--g-border)",
  textVar = "var(--g-text)",
  mutedVar = "var(--g-muted)",
  shadowVar = "var(--g-shadow)",
  dangerVar = "var(--g-danger)",
}: KpiMontantWaveProps) {
  const taillesMontant = {
    hero: "text-5xl",
    normal: "text-3xl",
    petit: "text-xl",
  } as const;

  const valeur =
    format === "pourcent"
      ? `${Math.round(Number(montant) || 0)}`
      : format === "nombre"
        ? String(Math.round(Number(montant) || 0))
        : formaterMontantSansDevise(montant);

  const suffixe =
    format === "pourcent" ? "%" : format === "nombre" ? null : "FCFA";

  return (
    <button
      type="button"
      onClick={cliquable ? onClick : undefined}
      disabled={!cliquable}
      className={`w-full text-left rounded-2xl p-5 ${cliquable ? "btn-press" : ""}`}
      style={{
        background: surfaceVar,
        border: `1px solid ${borderVar}`,
        boxShadow: taille === "hero" ? "0 8px 32px -4px rgba(0,0,0,0.12)" : shadowVar,
        cursor: cliquable ? "pointer" : "default",
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: `color-mix(in srgb, ${couleur} 20%, transparent)` }}
          >
            <Icone className="w-4 h-4" style={{ color: couleur }} />
          </div>
          <span
            className="text-xs font-semibold uppercase tracking-wide leading-snug"
            style={{ color: mutedVar }}
          >
            {label}
          </span>
        </div>
        {delta !== undefined && delta !== null && Number.isFinite(delta) ? (
          <div
            className="flex items-center gap-1 text-xs font-semibold shrink-0"
            style={{ color: delta >= 0 ? couleur : dangerVar }}
          >
            {delta >= 0 ? (
              <TrendingUp className="w-3.5 h-3.5" />
            ) : (
              <TrendingDown className="w-3.5 h-3.5" />
            )}
            {Math.abs(delta)}%
          </div>
        ) : null}
      </div>

      <div
        className={`font-black ${taillesMontant[taille]} tracking-tight`}
        style={{
          color: textVar,
          fontFamily: "var(--font-display)",
          lineHeight: 1.1,
        }}
      >
        <span>{valeur}</span>
        {suffixe ? (
          <span className="text-sm font-semibold ml-1.5" style={{ color: mutedVar }}>
            {suffixe}
          </span>
        ) : null}
      </div>

      {souslabel ? (
        <p className="text-xs mt-1.5" style={{ color: mutedVar }}>
          {souslabel}
        </p>
      ) : null}
    </button>
  );
}

export default KpiMontantWave;
