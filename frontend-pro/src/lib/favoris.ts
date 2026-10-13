import { authApi, favorisApi } from "@/lib/api";

const CACHE_KEY = "terrainsn_favoris_ids";
const PREFIX = "terrainsn_fav_";

export function favKey(id: number | string) {
  return `${PREFIX}${id}`;
}

function readLocalIds(): number[] {
  const ids = new Set<number>();
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      JSON.parse(cached).forEach((id: unknown) => {
        const n = Number(id);
        if (Number.isFinite(n) && n > 0) ids.add(n);
      });
    }
  } catch {
    /* ignore */
  }
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key?.startsWith(PREFIX)) continue;
      if (localStorage.getItem(key) !== "1") continue;
      const n = Number(key.slice(PREFIX.length));
      if (Number.isFinite(n) && n > 0) ids.add(n);
    }
  } catch {
    /* ignore */
  }
  return [...ids];
}

function writeLocalIds(ids: number[]) {
  const unique = [...new Set(ids.map(Number).filter((n) => Number.isFinite(n) && n > 0))];
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(unique));
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const key = localStorage.key(i);
      if (!key?.startsWith(PREFIX)) continue;
      const n = Number(key.slice(PREFIX.length));
      if (unique.includes(n)) localStorage.setItem(key, "1");
      else localStorage.removeItem(key);
    }
    for (const id of unique) {
      localStorage.setItem(favKey(id), "1");
    }
  } catch {
    /* ignore */
  }
  return unique;
}

export function isTerrainFavorite(id: number | string): boolean {
  try {
    if (localStorage.getItem(favKey(id)) === "1") return true;
    const cached = localStorage.getItem(CACHE_KEY);
    if (!cached) return false;
    return JSON.parse(cached).map(Number).includes(Number(id));
  } catch {
    return false;
  }
}

/** Charge les favoris (API si connecté, sinon localStorage). */
export async function loadFavoriteIds(): Promise<number[]> {
  const local = readLocalIds();
  if (!authApi.isAuthenticated?.() && !authApi.getToken?.()) return local;
  try {
    if (local.length) {
      const synced = await favorisApi.sync(local);
      const ids = (synced?.ids || []).map(Number);
      writeLocalIds(ids);
      return ids;
    }
    const remote = await favorisApi.list();
    const ids = (remote?.ids || []).map(Number);
    writeLocalIds(ids);
    return ids;
  } catch {
    return local;
  }
}

/** Bascule un favori — API + cache local si connecté. */
export async function toggleFavorite(terrainId: number | string): Promise<boolean> {
  const id = Number(terrainId);
  const currently = isTerrainFavorite(id);
  const loggedIn = Boolean(authApi.isAuthenticated?.() || authApi.getToken?.());

  if (!loggedIn) {
    const next = !currently;
    try {
      if (next) localStorage.setItem(favKey(id), "1");
      else localStorage.removeItem(favKey(id));
      const ids = readLocalIds();
      writeLocalIds(next ? [...ids, id] : ids.filter((x) => x !== id));
    } catch {
      /* ignore */
    }
    return next;
  }

  try {
    const result = await favorisApi.toggle(id);
    const next = Boolean(result?.favori);
    const ids = readLocalIds().filter((x) => x !== id);
    writeLocalIds(next ? [...ids, id] : ids);
    return next;
  } catch {
    const next = !currently;
    try {
      if (next) localStorage.setItem(favKey(id), "1");
      else localStorage.removeItem(favKey(id));
    } catch {
      /* ignore */
    }
    return next;
  }
}
