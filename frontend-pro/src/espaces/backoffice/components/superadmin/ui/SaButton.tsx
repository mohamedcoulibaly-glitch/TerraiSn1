import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "danger" | "ghost";
type Size = "sm" | "md" | "lg";

export type SaButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
};

const VARIANT: Record<Variant, string> = {
  primary: "sa-btn-primary",
  secondary: "sa-btn-secondary",
  danger: "sa-btn-danger",
  ghost: "sa-btn-ghost",
};

export function SaButton({
  variant = "primary",
  size = "md",
  loading,
  icon,
  className,
  children,
  disabled,
  ...props
}: SaButtonProps) {
  return (
    <button
      type="button"
      className={cn("sa-btn", VARIANT[variant], size === "sm" && "sa-btn-sm", size === "lg" && "sa-btn-lg", className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <Loader2 size={14} className="animate-spin" /> : icon}
      {children}
    </button>
  );
}

export default SaButton;
