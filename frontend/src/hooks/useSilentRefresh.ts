import { useCallback, useEffect, useRef } from "react";

type Options = {
  /** Rafraîchit les données sans recharger la page */
  onRefresh: () => void | Promise<void>;
  /** Min intervalle entre deux refresh silencieux (ms) */
  minIntervalMs?: number;
  enabled?: boolean;
};

/**
 * Synchro silencieuse au retour au premier plan (PWA / onglet),
 * sans window.location.reload — style WhatsApp Web.
 *
 * - visibilitychange / pageshow / online : refresh silencieux
 * - focus : aussi couvert, mais avec le même throttle (évite le spam)
 */
export function useSilentRefresh({ onRefresh, minIntervalMs = 12_000, enabled = true }: Options) {
  const lastAt = useRef(0);
  const busy = useRef(false);
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  const run = useCallback(async (reason: string) => {
    if (!enabled) return;
    const now = Date.now();
    if (busy.current) return;
    if (now - lastAt.current < minIntervalMs) return;
    busy.current = true;
    lastAt.current = now;
    try {
      await onRefreshRef.current();
    } catch (err) {
      if (import.meta.env.DEV) {
        console.warn("[silent-refresh]", reason, err);
      }
    } finally {
      busy.current = false;
    }
  }, [enabled, minIntervalMs]);

  useEffect(() => {
    if (!enabled) return;

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void run("visibility");
      }
    };
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) void run("pageshow");
    };
    const onOnline = () => {
      void run("online");
    };
    const onFocus = () => {
      // Throttleé : pas de reload, juste revalidate si le délai est passé
      if (document.visibilityState === "visible") void run("focus");
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("online", onOnline);
    window.addEventListener("focus", onFocus);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("focus", onFocus);
    };
  }, [enabled, run]);
}

export default useSilentRefresh;
