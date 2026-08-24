import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { terrainsApi, reservationsApi } from "@/lib/api";
import { readSwrCache, writeSwrCache } from "@/lib/swrCache";
import { localYmd } from "@/lib/localDate";

/** Cache-first joueur : pas de refetch au focus si la donnée est encore fraîche. */
const LIST_STALE_MS = 60_000;
const DETAIL_STALE_MS = 30_000;
const RESA_STALE_MS = 20_000;
const GC_MS = 1000 * 60 * 45;

export const joueurKeys = {
  terrainsList: (filtersKey: string) => ["joueur", "terrains", filtersKey] as const,
  terrainFull: (id: string | number, date: string, duree: number) =>
    ["joueur", "terrain-full", String(id), date, duree] as const,
  mesReservations: () => ["joueur", "mes-reservations"] as const,
};

function filtersToKey(filters?: Record<string, string | number | undefined | null>) {
  if (!filters) return "all";
  const entries = Object.entries(filters)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .sort(([a], [b]) => a.localeCompare(b));
  return entries.map(([k, v]) => `${k}=${v}`).join("&") || "all";
}

/**
 * Liste terrains Accueil — SWR + cache localStorage.
 */
export function useTerrainsList(
  filters?: Record<string, string | number | undefined | null>,
  enabled = true,
) {
  const filtersKey = filtersToKey(filters);
  const key = joueurKeys.terrainsList(filtersKey);
  const cached = useMemo(() => readSwrCache<any[]>(key), [filtersKey]);

  const query = useQuery({
    queryKey: key,
    enabled,
    queryFn: async () => {
      const list = (await terrainsApi.list(filters as any)) as any[];
      writeSwrCache(key, list);
      return list;
    },
    initialData: cached?.data,
    initialDataUpdatedAt: cached?.at,
    staleTime: LIST_STALE_MS,
    gcTime: GC_MS,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    placeholderData: (prev) => prev,
  });

  const isInitialLoading = query.isLoading && !query.data;
  const isRefetching = query.isFetching && !isInitialLoading;

  return {
    ...query,
    terrains: Array.isArray(query.data) ? query.data : [],
    isInitialLoading,
    isRefetching,
  };
}

/**
 * Fiche terrain consolidée (terrain + planning) — 1 requête.
 */
export function useTerrainFullDetails(
  id: string | number | undefined,
  opts?: { date?: string; duree_minutes?: number; enabled?: boolean },
) {
  const date = opts?.date || localYmd();
  const duree = opts?.duree_minutes ?? 60;
  const enabled = Boolean(id) && (opts?.enabled !== false);
  const key = joueurKeys.terrainFull(id || "x", date, duree);
  const cached = useMemo(() => readSwrCache<any>(key), [id, date, duree]);

  const query = useQuery({
    queryKey: key,
    enabled,
    queryFn: async () => {
      const data = await terrainsApi.getFullDetails(id!, {
        date,
        duree_minutes: duree,
      });
      writeSwrCache(key, data);
      return data;
    },
    initialData: cached?.data,
    initialDataUpdatedAt: cached?.at,
    staleTime: DETAIL_STALE_MS,
    gcTime: GC_MS,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    placeholderData: (prev) => prev,
  });

  const isInitialLoading = query.isLoading && !query.data;
  const isRefetching = query.isFetching && !isInitialLoading;

  return {
    ...query,
    terrain: query.data ?? null,
    planning: query.data?.planning ?? null,
    isInitialLoading,
    isRefetching,
  };
}

/**
 * Mes réservations joueur — cache-first.
 */
export function useMesReservations(enabled = true) {
  const key = joueurKeys.mesReservations();
  const cached = useMemo(() => readSwrCache<any[]>(key), []);

  const query = useQuery({
    queryKey: key,
    enabled,
    queryFn: async () => {
      const data = await reservationsApi.mes();
      const list = Array.isArray(data) ? data : [];
      writeSwrCache(key, list);
      return list;
    },
    initialData: cached?.data,
    initialDataUpdatedAt: cached?.at,
    staleTime: RESA_STALE_MS,
    gcTime: GC_MS,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    placeholderData: (prev) => prev,
  });

  const isInitialLoading = query.isLoading && !query.data;
  const isRefetching = query.isFetching && !isInitialLoading;

  return {
    ...query,
    reservations: Array.isArray(query.data) ? query.data : [],
    isInitialLoading,
    isRefetching,
  };
}
