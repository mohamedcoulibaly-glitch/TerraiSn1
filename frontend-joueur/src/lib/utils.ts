import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function formatThousands(value: number | string | null | undefined): string {
  const n = Number(value);
  const safe = Number.isFinite(n) ? Math.round(n) : 0;
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 })
    .format(safe)
    .replace(/[\u00a0\u202f]/g, " ");
}

/** `400 000 FCFA` */
export function formatFcfa(value: number | string | null | undefined): string {
  return `${formatThousands(value)} FCFA`;
}

/** `400 000 FCFA / h` */
export function formatFcfaPerHour(value: number | string | null | undefined): string {
  return `${formatFcfa(value)} / h`;
}
