import SaBadge, { type ModeRevenu } from "./SaBadge";

const LABELS: Record<ModeRevenu, string> = {
  essai: "Essai",
  commission: "Commission",
  abonnement: "Abonnement",
  achat: "Achat définitif",
};

export function ModeRevenuBadge({ mode, className }: { mode: ModeRevenu; className?: string }) {
  return <SaBadge mode={mode} className={className}>{LABELS[mode]}</SaBadge>;
}

export default ModeRevenuBadge;
