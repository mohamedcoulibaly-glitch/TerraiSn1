import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type SaCardProps = {
  className?: string;
  children: ReactNode;
};

export function SaCard({ className, children }: SaCardProps) {
  return <section className={cn("sa-card", className)}>{children}</section>;
}

export function SaCardHeader({ className, children }: SaCardProps) {
  return <div className={cn("sa-card-header", className)}>{children}</div>;
}

export function SaCardBody({ className, children }: SaCardProps) {
  return <div className={cn("sa-card-body", className)}>{children}</div>;
}

export function SaCardFooter({ className, children }: SaCardProps) {
  return <div className={cn("sa-card-footer", className)}>{children}</div>;
}

export default SaCard;
