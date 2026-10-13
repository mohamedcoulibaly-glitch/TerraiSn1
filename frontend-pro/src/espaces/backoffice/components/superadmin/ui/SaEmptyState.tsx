import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export type SaEmptyStateProps = {
  icon: LucideIcon;
  titre: string;
  description?: string;
  action?: ReactNode;
  className?: string;
};

export function SaEmptyState({ icon: Icon, titre, description, action, className }: SaEmptyStateProps) {
  return (
    <div className={`py-12 px-4 text-center ${className || ""}`}>
      <Icon size={48} className="mx-auto" style={{ color: "var(--sa-text-muted)" }} />
      <p className="mt-3 text-[15px] font-medium" style={{ color: "var(--sa-text-2)" }}>{titre}</p>
      {description ? <p className="mt-1 text-[13px]" style={{ color: "var(--sa-text-muted)" }}>{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export default SaEmptyState;
