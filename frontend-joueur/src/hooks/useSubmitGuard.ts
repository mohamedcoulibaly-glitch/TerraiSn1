import { useCallback, useRef, useState } from "react";

/**
 * Empêche le double-submit et les rafales (US-26).
 * - ignore les clics pendant `busy`
 * - debounce optionnel entre deux tentatives
 */
export function useSubmitGuard(opts?: { debounceMs?: number }) {
  const debounceMs = opts?.debounceMs ?? 600;
  const [busy, setBusy] = useState(false);
  const lastAt = useRef(0);

  const run = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
      const now = Date.now();
      if (busy) return undefined;
      if (now - lastAt.current < debounceMs) return undefined;
      lastAt.current = now;
      setBusy(true);
      try {
        return await fn();
      } finally {
        setBusy(false);
      }
    },
    [busy, debounceMs],
  );

  return { busy, run };
}
