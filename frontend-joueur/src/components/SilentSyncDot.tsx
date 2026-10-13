type Props = {
  active?: boolean;
  label?: string;
  className?: string;
};

/**
 * Micro-indicateur de synchro silencieuse (pas de skeleton / spinner global).
 */
export default function SilentSyncDot({
  active = false,
  label = "Synchronisation",
  className = "",
}: Props) {
  if (!active) return null;

  return (
    <div
      className={`pointer-events-none fixed z-[60] top-[max(0.75rem,env(safe-area-inset-top))] right-[max(0.75rem,env(safe-area-inset-right))] flex items-center gap-1.5 ${className}`}
      role="status"
      aria-live="polite"
      aria-label={label}
      title={label}
    >
      <span className="relative flex h-2.5 w-2.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500 shadow-[0_0_0_2px_rgba(255,255,255,0.85)]" />
      </span>
      <span className="sr-only">{label}…</span>
    </div>
  );
}
