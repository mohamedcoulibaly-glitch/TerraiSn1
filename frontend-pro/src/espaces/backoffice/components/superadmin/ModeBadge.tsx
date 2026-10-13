import { Hand, Zap } from "lucide-react";

type Props = {
  mode: "auto" | "retrait";
};

export default function ModeBadge({ mode }: Props) {
  if (mode === "auto") {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
        style={{ background: "var(--sa-primary-glow)", color: "var(--sa-primary)" }}
      >
        <Zap size={11} />
        Auto
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
      style={{ background: "var(--sa-surface-2)", color: "var(--sa-text-2)" }}
    >
      <Hand size={11} />
      Retrait
    </span>
  );
}
