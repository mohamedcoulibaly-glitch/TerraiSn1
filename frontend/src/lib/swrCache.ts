/** Cache local Stale-While-Revalidate (persistance légère, style WhatsApp Web). */

const PREFIX = "terrainsn:swr:";

export type SwrEnvelope<T> = { at: number; data: T };

function keyToString(key: unknown): string {
  return `${PREFIX}${typeof key === "string" ? key : JSON.stringify(key)}`;
}

export function readSwrCache<T>(key: unknown): SwrEnvelope<T> | undefined {
  try {
    const raw = localStorage.getItem(keyToString(key));
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as SwrEnvelope<T>;
    if (!parsed || typeof parsed.at !== "number" || parsed.data === undefined) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

export function writeSwrCache<T>(key: unknown, data: T): void {
  try {
    const envelope: SwrEnvelope<T> = { at: Date.now(), data };
    localStorage.setItem(keyToString(key), JSON.stringify(envelope));
  } catch {
    /* quota / private mode */
  }
}

export function clearSwrCache(key: unknown): void {
  try {
    localStorage.removeItem(keyToString(key));
  } catch {
    /* ignore */
  }
}
