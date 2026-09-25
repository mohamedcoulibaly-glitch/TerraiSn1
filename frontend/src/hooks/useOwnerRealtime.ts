import { useEffect, useRef, useState } from "react";
import type { TerrainEventPayload } from "./useTerrainEvents";

const API_URL = import.meta.env.VITE_API_URL || "/api";

/**
 * Abonnement SSE multi-terrains pour le dashboard propriétaire.
 * Réutilise le hub `/terrains/:id/events` (1 EventSource par terrain).
 */
export function useOwnerRealtime(
  terrainIds: Array<number | string> | null | undefined,
  onEvent: (payload: TerrainEventPayload) => void,
) {
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;
  const [connected, setConnected] = useState(false);

  const idsKey = (terrainIds || [])
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0)
    .sort((a, b) => a - b)
    .join(",");

  useEffect(() => {
    if (!idsKey) {
      setConnected(false);
      return;
    }
    const ids = idsKey.split(",").map(Number);

    let closed = false;
    const sources: EventSource[] = [];
    const timers = new Map<number, number>();
    const retries = new Map<number, number>();
    const openIds = new Set<number>();

    const syncConnected = () => {
      if (!closed) setConnected(openIds.size > 0);
    };

    const connectOne = (id: number) => {
      if (closed) return;
      const es = new EventSource(`${API_URL}/terrains/${id}/events`);
      sources.push(es);

      es.addEventListener("terrain", (ev) => {
        try {
          const data = JSON.parse((ev as MessageEvent).data) as TerrainEventPayload;
          handlerRef.current(data);
        } catch {
          /* ignore */
        }
      });

      es.onopen = () => {
        retries.set(id, 1500);
        openIds.add(id);
        syncConnected();
      };

      es.onerror = () => {
        openIds.delete(id);
        syncConnected();
        es.close();
        const idx = sources.indexOf(es);
        if (idx >= 0) sources.splice(idx, 1);
        if (closed) return;
        const retryMs = retries.get(id) || 1500;
        const timer = window.setTimeout(() => connectOne(id), retryMs);
        timers.set(id, timer);
        retries.set(id, Math.min(retryMs * 1.6, 20000));
      };
    };

    ids.forEach(connectOne);

    return () => {
      closed = true;
      setConnected(false);
      timers.forEach((t) => window.clearTimeout(t));
      timers.clear();
      sources.forEach((es) => es.close());
    };
  }, [idsKey]);

  return connected;
}
