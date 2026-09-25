import { useEffect, useRef } from "react";

const API_URL = import.meta.env.VITE_API_URL || "/api";

export type TerrainEventPayload = {
  type: string;
  terrain_id: number;
  at?: string;
  date?: string;
  [key: string]: unknown;
};

/**
 * Abonnement SSE aux changements d’un terrain (horaires, blocages, réservations, tarifs).
 * Reconnexion automatique avec backoff simple.
 */
export function useTerrainEvents(
  terrainId: number | string | null | undefined,
  onEvent: (payload: TerrainEventPayload) => void,
) {
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    const id = Number(terrainId);
    if (!Number.isFinite(id) || id <= 0) return;

    let es: EventSource | null = null;
    let closed = false;
    let retryMs = 1500;
    let timer: number | undefined;

    const connect = () => {
      if (closed) return;
      es = new EventSource(`${API_URL}/terrains/${id}/events`);

      es.addEventListener("terrain", (ev) => {
        try {
          const data = JSON.parse((ev as MessageEvent).data) as TerrainEventPayload;
          handlerRef.current(data);
        } catch {
          /* ignore malformed */
        }
      });

      es.onopen = () => {
        retryMs = 1500;
      };

      es.onerror = () => {
        es?.close();
        es = null;
        if (closed) return;
        timer = window.setTimeout(connect, retryMs);
        retryMs = Math.min(retryMs * 1.6, 20000);
      };
    };

    connect();

    return () => {
      closed = true;
      if (timer) window.clearTimeout(timer);
      es?.close();
    };
  }, [terrainId]);
}
