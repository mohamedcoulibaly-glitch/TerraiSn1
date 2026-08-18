import { usePreviewContrat } from "@/hooks/usePreviewContrat";
import { fcfa, type FraisPolitique, type PayoutMode } from "@/lib/saContrat";

type Props = {
  prix?: number;
  pctAvance: number;
  pctCommission: number;
  mode: PayoutMode;
  politiqueFrais: FraisPolitique;
  pctFraisGerant?: number;
  pctFraisPlateforme?: number;
};

function Colonne({
  titre,
  selected,
  rows,
  net,
  via,
}: {
  titre: string;
  selected: boolean;
  rows: { label: string; value: string; muted?: boolean }[];
  net: string;
  via: string;
}) {
  return (
    <div
      className="rounded-[10px] p-4"
      style={{
        background: selected ? "var(--sa-primary-glow)" : "var(--sa-surface)",
        border: selected ? "1.5px solid var(--sa-primary)" : "1px solid var(--sa-border)",
      }}
    >
      <p className="text-[12px] font-semibold mb-3" style={{ color: "var(--sa-text)" }}>
        {titre}
      </p>
      <dl className="space-y-1.5">
        {rows.map((r) => (
          <div key={r.label} className="flex justify-between gap-3 text-[12px]">
            <dt style={{ color: "var(--sa-muted)" }}>{r.label}</dt>
            <dd style={{ color: r.muted ? "var(--sa-muted)" : "var(--sa-text)" }}>{r.value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--sa-border)" }}>
        <div className="flex justify-between gap-3 text-[13px] font-semibold">
          <span style={{ color: "var(--sa-text)" }}>Gérant reçoit</span>
          <span style={{ color: "var(--sa-success)" }}>{net}</span>
        </div>
        <p className="text-[10px] mt-1" style={{ color: "var(--sa-muted)" }}>
          Via : {via}
        </p>
      </div>
    </div>
  );
}

export default function PreviewContrat(props: Props) {
  const p = usePreviewContrat(props);

  return (
    <div className="rounded-[10px] p-4" style={{ background: "var(--sa-surface-2)" }}>
      <p className="text-[13px] font-semibold" style={{ color: "var(--sa-text)" }}>
        Aperçu sur un créneau à {fcfa(p.prix)}
      </p>
      <p className="text-[11px] mt-0.5 mb-3" style={{ color: "var(--sa-muted)" }}>
        (Base gérant = avance − commission)
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Colonne
          titre="Mode Auto (frais selon politique)"
          selected={props.mode === "auto"}
          rows={[
            { label: "Base gérant", value: fcfa(p.baseGerant) },
            { label: "Frais gérant", value: `−${fcfa(p.auto.fraisGerant)}` },
            { label: "Frais TerrainSN", value: `−${fcfa(p.auto.fraisPlateforme)}` },
          ]}
          net={fcfa(p.auto.net)}
          via="PayTech automatique"
        />
        <Colonne
          titre="Mode Retrait (0 frais)"
          selected={props.mode === "retrait"}
          rows={[
            { label: "Base gérant", value: fcfa(p.baseGerant) },
            { label: "Frais", value: fcfa(0) },
          ]}
          net={fcfa(p.retrait.net)}
          via="Virement manuel équipe"
        />
      </div>
    </div>
  );
}
