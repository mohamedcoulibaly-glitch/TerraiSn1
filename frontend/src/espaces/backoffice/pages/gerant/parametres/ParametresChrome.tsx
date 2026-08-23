import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

export function SubView({
  title,
  onBack,
  children,
}: {
  title: string;
  onBack: () => void;
  children: ReactNode;
}) {
  return (
    <div className="space-y-4 pb-6">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-2 min-h-[48px] px-2 -ml-2 rounded-xl text-base font-semibold"
        style={{ color: "var(--g-primary)" }}
      >
        <ArrowLeft className="w-5 h-5" />
        Retour aux paramètres
      </button>
      <h1
        className="text-xl font-semibold leading-tight"
        style={{ color: "var(--g-text)", fontFamily: "var(--font-display)" }}
      >
        {title}
      </h1>
      {children}
    </div>
  );
}

export function Surface({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={cn("rounded-2xl p-4 space-y-3", className)}
      style={{ background: "var(--g-surface)", boxShadow: "var(--g-shadow)" }}
    >
      {children}
    </section>
  );
}
