import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

export type BadgeTone = "libre" | "presque" | "complet" | "neutral";

const overlayClass =
  "inline-flex items-center gap-1.5 backdrop-blur-md bg-black/40 text-white border border-white/10 text-xs font-medium px-2.5 py-1 rounded-full";

const dotClass: Record<Exclude<BadgeTone, "neutral">, string> = {
  libre: "bg-emerald-400",
  presque: "bg-amber-400",
  complet: "bg-red-400",
};

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  children: ReactNode;
  tone?: BadgeTone;
  withDot?: boolean;
};

/** Badge overlay unique (distance, statut) — verre sombre, jamais de fond fluo. */
export function Badge({ children, className, tone = "neutral", withDot = false, ...props }: BadgeProps) {
  const showDot = withDot && tone !== "neutral";
  return (
    <span className={cn(overlayClass, className)} {...props}>
      {showDot && (
        <span
          className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dotClass[tone])}
          aria-hidden
        />
      )}
      {children}
    </span>
  );
}

export default Badge;
