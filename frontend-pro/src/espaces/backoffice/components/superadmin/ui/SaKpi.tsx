import type { LucideIcon } from "lucide-react";
import { TrendingDown, TrendingUp } from "lucide-react";

export type SaKpiProps = {
  icon: LucideIcon;
  iconBg: string;
  iconColor: string;
  value: string;
  label: string;
  delta?: number;
  className?: string;
};

export function SaKpi({ icon: Icon, iconBg, iconColor, value, label, delta, className }: SaKpiProps) {
  return (
    <article className={`sa-kpi ${className || ""}`}>
      <div className="flex items-start justify-between">
        <span className="sa-kpi-icon" style={{ background: iconBg, color: iconColor }}>
          <Icon size={16} />
        </span>
      </div>
      <p className="sa-kpi-value">{value}</p>
      <p className="sa-kpi-label">{label}</p>
      {typeof delta === "number" ? (
        <p className="sa-kpi-delta" style={{ color: delta >= 0 ? "var(--sa-success)" : "var(--sa-danger)" }}>
          {delta >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
          {delta >= 0 ? "+" : ""}
          {delta}% vs mois dernier
        </p>
      ) : null}
    </article>
  );
}

export default SaKpi;
