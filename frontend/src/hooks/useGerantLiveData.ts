import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { gerantApi } from "@/lib/api";
import { readSwrCache, writeSwrCache } from "@/lib/swrCache";
import { localYmd } from "@/lib/localDate";

export const gerantLiveKeys = {
  dashboard: () => ["gerant", "live", "dashboard"] as const,
  today: (date?: string | null) => ["gerant", "live", "today", date || "auto"] as const,
  week: () => ["gerant", "live", "week"] as const,
};

export type GerantTodayPayload = {
  date: string;
  reservations: any[];
};

function sortByHeure(reservations: any[]) {
  return [...(reservations || [])].sort((a, b) => {
    const ta = String(a.heure_debut || "00:00").slice(0, 5);
    const tb = String(b.heure_debut || "00:00").slice(0, 5);
    return ta.localeCompare(tb);
  });
}

const LIVE_STALE_MS = 8_000;
const LIVE_GC_MS = 1000 * 60 * 45;

/**
 * Dashboard gérant — SWR : cache immédiat + refetch silencieux au focus / intervalle.
 */
export function useGerantDashboard(enabled = true) {
  const key = gerantLiveKeys.dashboard();
  const cached = useMemo(() => readSwrCache<any>(key), []);

  const query = useQuery({
    queryKey: key,
    enabled,
    queryFn: async () => {
      const data = await gerantApi.dashboard();
      writeSwrCache(key, data);
      return data;
    },
    initialData: cached?.data,
    initialDataUpdatedAt: cached?.at,
    staleTime: LIVE_STALE_MS,
    gcTime: LIVE_GC_MS,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    refetchInterval: 60_000,
    placeholderData: (prev) => prev,
  });

  const isInitialLoading = query.isLoading && !query.data;
  const isRefetching = query.isFetching && !isInitialLoading;

  return {
    ...query,
    dashboard: query.data ?? null,
    isInitialLoading,
    isRefetching,
  };
}

/**
 * Réservations du jour — même stratégie SWR.
 */
export function useGerantToday(date?: string | null, enabled = true) {
  const dateKey = date || undefined;
  const key = gerantLiveKeys.today(dateKey);
  const cached = useMemo(() => readSwrCache<GerantTodayPayload>(key), [dateKey]);

  const query = useQuery({
    queryKey: key,
    enabled,
    queryFn: async () => {
      const data = (await gerantApi.reservationsToday(dateKey)) as GerantTodayPayload;
      const payload: GerantTodayPayload = {
        date: data.date || dateKey || localYmd(),
        reservations: sortByHeure(data.reservations || []),
      };
      writeSwrCache(key, payload);
      // Aussi écrire la clé "auto" pour le retour PWA sans date figée
      if (!dateKey) writeSwrCache(gerantLiveKeys.today("auto"), payload);
      return payload;
    },
    initialData: cached?.data,
    initialDataUpdatedAt: cached?.at,
    staleTime: LIVE_STALE_MS,
    gcTime: LIVE_GC_MS,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    refetchInterval: 60_000,
    placeholderData: (prev) => prev,
  });

  const isInitialLoading = query.isLoading && !query.data;
  const isRefetching = query.isFetching && !isInitialLoading;

  return {
    ...query,
    todayPayload: query.data ?? null,
    isInitialLoading,
    isRefetching,
  };
}

export function useGerantWeek(enabled = true) {
  const key = gerantLiveKeys.week();
  const cached = useMemo(() => readSwrCache<{ reservations: any[] }>(key), []);

  const query = useQuery({
    queryKey: key,
    enabled,
    queryFn: async () => {
      const data = (await gerantApi.reservationsWeek()) as { reservations?: any[] };
      const payload = { reservations: sortByHeure(data.reservations || []) };
      writeSwrCache(key, payload);
      return payload;
    },
    initialData: cached?.data,
    initialDataUpdatedAt: cached?.at,
    staleTime: LIVE_STALE_MS,
    gcTime: LIVE_GC_MS,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    refetchInterval: enabled ? 60_000 : false,
    placeholderData: (prev) => prev,
  });

  const isInitialLoading = query.isLoading && !query.data;
  const isRefetching = query.isFetching && !isInitialLoading;

  return {
    ...query,
    weekReservations: query.data?.reservations ?? [],
    isInitialLoading,
    isRefetching,
  };
}

/** Invalide / refetch silencieux de toutes les sources live gérant. */
export function useGerantLiveInvalidate() {
  const queryClient = useQueryClient();

  const silentRefetch = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["gerant", "live"], refetchType: "active" }),
    ]);
  }, [queryClient]);

  const patchTodayReservation = useCallback(
    (reservationId: number, patch: Record<string, unknown>, date?: string | null) => {
      const clean = Object.fromEntries(
        Object.entries(patch).filter(([, v]) => v !== undefined),
      );
      const apply = (key: readonly unknown[]) => {
        queryClient.setQueryData<GerantTodayPayload>(key, (prev) => {
          if (!prev) return prev;
          let found = false;
          const reservations = prev.reservations.map((r) => {
            if (Number(r.id) !== Number(reservationId)) return r;
            found = true;
            return { ...r, ...clean };
          });
          if (!found) return prev;
          const next = { ...prev, reservations };
          writeSwrCache(key, next);
          return next;
        });
      };
      apply(gerantLiveKeys.today(date));
      apply(gerantLiveKeys.today("auto"));
      apply(gerantLiveKeys.today(undefined));
    },
    [queryClient],
  );

  const removeBlocagesOptimistic = useCallback(
    (ids: number[]) => {
      const idSet = new Set(ids.map(Number));
      queryClient.setQueryData(gerantLiveKeys.dashboard(), (prev: any) => {
        if (!prev) return prev;
        const next = {
          ...prev,
          blocages: (prev.blocages || []).filter((b: any) => !idSet.has(Number(b.id))),
        };
        writeSwrCache(gerantLiveKeys.dashboard(), next);
        return next;
      });
    },
    [queryClient],
  );

  const restoreDashboard = useCallback(
    (snapshot: unknown) => {
      if (snapshot == null) return;
      queryClient.setQueryData(gerantLiveKeys.dashboard(), snapshot);
      writeSwrCache(gerantLiveKeys.dashboard(), snapshot);
    },
    [queryClient],
  );

  return {
    queryClient,
    silentRefetch,
    patchTodayReservation,
    removeBlocagesOptimistic,
    restoreDashboard,
  };
}
