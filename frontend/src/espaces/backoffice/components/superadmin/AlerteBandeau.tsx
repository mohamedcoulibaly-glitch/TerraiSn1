import { AlertTriangle, Info } from "lucide-react";
import { Link } from "react-router-dom";

type Props = {
  type: "danger" | "warning" | "info";
  message: string;
  lien?: string;
  labelLien?: string;
};

const TONES = {
  danger: {
    bg: "var(--sa-danger-bg)",
    border: "var(--sa-danger)",
    color: "var(--sa-danger)",
    Icon: AlertTriangle,
  },
  warning: {
    bg: "var(--sa-warning-bg)",
    border: "var(--sa-warning)",
    color: "var(--sa-warning)",
    Icon: AlertTriangle,
  },
  info: {
    bg: "var(--sa-info-bg)",
    border: "var(--sa-info)",
    color: "var(--sa-info)",
    Icon: Info,
  },
};

export default function AlerteBandeau({ type, message, lien, labelLien }: Props) {
  const tone = TONES[type];
  const Icon = tone.Icon;
  return (
    <div
      className="flex items-start sm:items-center gap-3 rounded-xl px-4 py-3.5"
      style={{ background: tone.bg, border: `1px solid ${tone.border}` }}
    >
      <Icon size={16} className="shrink-0 mt-0.5 sm:mt-0" style={{ color: tone.color }} />
      <p className="flex-1 text-[13px] font-medium" style={{ color: "var(--sa-text)" }}>
        {message}
      </p>
      {lien && labelLien ? (
        <Link
          to={lien}
          className="text-[12px] font-semibold shrink-0 underline-offset-2 hover:underline"
          style={{ color: tone.color }}
        >
          {labelLien}
        </Link>
      ) : null}
    </div>
  );
}
