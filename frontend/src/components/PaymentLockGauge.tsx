import { useEffect, useMemo, useState } from "react";

type Props = {
  /** Epoch ms de fin du verrou paiement */
  expiresAt: number | null | undefined;
  /** Epoch ms de début (created_at) — optionnel pour jauge plus précise */
  startedAt?: number | string | null;
  /** Durée totale de référence en minutes (fallback si pas de startedAt) */
  durationMin?: number;
  className?: string;
  onExpired?: () => void;
};

function parseStart(raw?: number | string | null): number | null {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  const t = new Date(String(raw)).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * Jauge de temps pour réservation en_attente (verrou paiement).
 * Vert → orange → rouge, puis callback à l'expiration.
 */
export default function PaymentLockGauge({
  expiresAt,
  startedAt,
  durationMin = 15,
  className = "",
  onExpired,
}: Props) {
  const endMs = Number(expiresAt);
  const valid = Number.isFinite(endMs) && endMs > 0;
  const [now, setNow] = useState(() => Date.now());
  const expiredRef = useMemo(() => ({ fired: false }), []);

  useEffect(() => {
    if (!valid) return;
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(tick);
  }, [valid, endMs]);

  useEffect(() => {
    if (!valid || expiredRef.fired) return;
    if (now >= endMs) {
      expiredRef.fired = true;
      onExpired?.();
    }
  }, [now, endMs, valid, onExpired, expiredRef]);

  if (!valid) return null;

  const startMs =
    parseStart(startedAt) ??
    endMs - Math.max(1, Number(durationMin) || 15) * 60_000;
  const total = Math.max(1, endMs - startMs);
  const left = Math.max(0, endMs - now);
  const ratio = Math.min(1, Math.max(0, left / total));
  const pct = Math.round(ratio * 100);
  const seconds = Math.ceil(left / 1000);
  const mm = Math.floor(seconds / 60);
  const ss = String(seconds % 60).padStart(2, "0");

  const color =
    ratio > 0.45 ? "#16a34a" : ratio > 0.18 ? "#d97706" : "#dc2626";
  const glow =
    ratio > 0.45
      ? "rgba(22,163,74,0.25)"
      : ratio > 0.18
        ? "rgba(217,119,6,0.28)"
        : "rgba(220,38,38,0.3)";

  const expired = left <= 0;

  return (
    <div className={`space-y-1.5 ${className}`}>
      <div
        className="h-2 w-full rounded-full overflow-hidden"
        style={{ background: "color-mix(in srgb, var(--color-border, #e5e7eb) 80%, transparent)" }}
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={expired ? "Créneau libéré" : `Temps restant ${mm}:${ss}`}
      >
        <div
          className="h-full rounded-full transition-[width,background-color] duration-1000 ease-linear"
          style={{
            width: expired ? "0%" : `${pct}%`,
            background: color,
            boxShadow: expired ? "none" : `0 0 10px ${glow}`,
          }}
        />
      </div>
      <p
        className={`text-[11px] font-semibold tabular-nums ${expired ? "animate-pulse" : ""}`}
        style={{ color }}
      >
        {expired ? "Créneau libéré" : `${mm}:${ss}`}
      </p>
    </div>
  );
}
