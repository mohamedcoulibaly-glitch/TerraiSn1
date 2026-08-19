import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type ModeRevenu = "essai" | "commission" | "abonnement" | "achat";

export type SaBadgeProps = {
  mode?: ModeRevenu;
  children: ReactNode;
  className?: string;
};

export function SaBadge({ mode, children, className }: SaBadgeProps) {
  return (
    <span className={cn("sa-badge", mode ? `sa-badge-${mode}` : "", className)} style={!mode ? { borderColor: "var(--sa-border)", color: "var(--sa-text-3)", background: "var(--sa-surface-2)" } : undefined}>
      {children}
    </span>
  );
}

export default SaBadge;
