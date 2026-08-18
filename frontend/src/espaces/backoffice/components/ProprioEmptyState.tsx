import { ShieldCheck } from "lucide-react";

export default function ProprioEmptyState({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <div className="max-w-md mx-auto py-16 text-center px-4">
      <div
        className="mx-auto h-16 w-16 rounded-full flex items-center justify-center"
        style={{ background: "var(--p-primary-glow)" }}
      >
        <ShieldCheck className="h-7 w-7" style={{ color: "var(--p-primary)" }} />
      </div>
      <h2
        className="mt-4 text-lg font-bold"
        style={{ fontFamily: "var(--font-display)", color: "var(--p-text)" }}
      >
        {title}
      </h2>
      <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--p-text-2)" }}>
        {subtitle}
      </p>
    </div>
  );
}
