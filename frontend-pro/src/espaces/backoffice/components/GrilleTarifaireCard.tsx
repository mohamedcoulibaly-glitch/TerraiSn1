import type { GrilleValues } from "@/espaces/backoffice/components/GrilleTarifaireForm";

function fcfa(n?: number) {
  return `${Number(n || 0).toLocaleString("fr-FR")} FCFA/h`;
}

function BandLine({
  label,
  demi,
  entier,
}: {
  label: string;
  demi: number;
  entier: number;
}) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
      <span className="text-[11px] font-medium shrink-0" style={{ color: "var(--g-muted)" }}>
        {label}
      </span>
      <span className="text-[12px] leading-snug text-right" style={{ color: "var(--g-text)" }}>
        Demi {fcfa(demi)}
        <span style={{ color: "var(--g-muted)" }}> · </span>
        Entier {fcfa(entier)}
      </span>
    </div>
  );
}

export default function GrilleTarifaireCard({ grille }: { grille: GrilleValues }) {
  const pivotS = String(grille.heure_pivot_semaine || "18:00").slice(0, 5);
  const pivotW = String(grille.heure_pivot_weekend || "18:00").slice(0, 5);

  return (
    <div
      className="rounded-xl px-3 py-2.5 space-y-2.5"
      style={{ background: "var(--g-surface-2)", border: "1px solid var(--g-border)" }}
    >
      <div className="space-y-1.5">
        <p className="text-xs font-semibold" style={{ color: "var(--g-text)" }}>
          Semaine (lun. – ven.)
        </p>
        <BandLine
          label={`Avant ${pivotS}`}
          demi={grille.semaine.avant.demi}
          entier={grille.semaine.avant.entier}
        />
        <BandLine
          label={`Après ${pivotS}`}
          demi={grille.semaine.apres.demi}
          entier={grille.semaine.apres.entier}
        />
      </div>

      <div className="h-px" style={{ background: "var(--g-border)" }} />

      <div className="space-y-1.5">
        <p className="text-xs font-semibold" style={{ color: "var(--g-text)" }}>
          Week-end (sam. – dim.)
        </p>
        <BandLine
          label={`Avant ${pivotW}`}
          demi={grille.weekend.avant.demi}
          entier={grille.weekend.avant.entier}
        />
        <BandLine
          label={`Après ${pivotW}`}
          demi={grille.weekend.apres.demi}
          entier={grille.weekend.apres.entier}
        />
      </div>
    </div>
  );
}
