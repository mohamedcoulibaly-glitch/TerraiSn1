import type { CanalStatut } from "@/lib/saContrat";

const LABELS: Record<CanalStatut, string> = {
  verifie: "✓",
  test_envoye: "~",
  saisi: "?",
  absent: "✗",
};

type Props = {
  statut: CanalStatut;
  operateur: "wave" | "om";
};

export default function ContratBadge({ statut, operateur }: Props) {
  const prefix = operateur === "wave" ? "W" : "OM";
  const color =
    statut === "verifie"
      ? "var(--sa-verifie)"
      : statut === "absent"
        ? "var(--sa-absent)"
        : "var(--sa-test-envoye)";
  const bg =
    statut === "verifie"
      ? "var(--sa-verifie-bg)"
      : statut === "absent"
        ? "var(--sa-absent-bg)"
        : "var(--sa-test-envoye-bg)";

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold shrink-0 whitespace-nowrap"
      style={{ background: bg, color }}
    >
      <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: color }} />
      {prefix} {LABELS[statut]}
    </span>
  );
}
