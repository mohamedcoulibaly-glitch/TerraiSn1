import { cn } from "@/lib/utils";

/** Skeleton réutilisable avec shimmer GPU-friendly (opacity via gradient animé). */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("skeleton rounded-md", className)}
      aria-hidden
      {...props}
    />
  );
}

export { Skeleton };
