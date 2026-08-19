import type { ReactNode } from "react";

export type SaFilterBarProps = {
  children: ReactNode;
  className?: string;
};

export function SaFilterBar({ children, className }: SaFilterBarProps) {
  return <div className={`flex flex-wrap items-center gap-2 ${className || ""}`}>{children}</div>;
}

export default SaFilterBar;
