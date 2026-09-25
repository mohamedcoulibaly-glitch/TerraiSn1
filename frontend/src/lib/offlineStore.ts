import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

export interface CachedReservation {
  id: number;
  terrain_id: number;
  terrain_nom: string;
  date: string;
  heure_debut: string;
  heure_fin: string;
  statut: string;
  prix_total?: number;
  montant?: number;
  reste_a_payer?: number;
  syncedAt: number;
}

export interface PendingReservation {
  id: string;
  payload: {
    terrain_id: number;
    date: string;
    heure_debut: string;
    heure_fin: string;
    joueur_nom: string;
    joueur_telephone: string;
    format_terrain?: 'moitie' | 'entier';
  };
  token: string | null;
  createdAt: number;
  status: 'pending' | 'failed';
}

export interface CachedProfile {
  key: string;
  role: string;
  data: unknown;
  syncedAt: number;
}

export interface CachedRecentTerrain {
  id: number;
  data: unknown;
  viewedAt: number;
}

interface TerrainSNDB extends DBSchema {
  reservations: {
    key: number;
    value: CachedReservation;
    indexes: { 'by-date': string };
  };
  pendingReservations: {
    key: string;
    value: PendingReservation;
  };
  terrainsCache: {
    key: string;
    value: { key: string; data: unknown; syncedAt: number };
  };
  profiles: {
    key: string;
    value: CachedProfile;
  };
  recentTerrains: {
    key: number;
    value: CachedRecentTerrain;
    indexes: { 'by-viewed': number };
  };
}

const DB_NAME = 'terrainsn-offline';
const DB_VERSION = 2;
const MAX_RECENT_TERRAINS = 20;

let dbPromise: Promise<IDBPDatabase<TerrainSNDB>> | null = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB<TerrainSNDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          const reservations = db.createObjectStore('reservations', { keyPath: 'id' });
          reservations.createIndex('by-date', 'date');
          db.createObjectStore('pendingReservations', { keyPath: 'id' });
          db.createObjectStore('terrainsCache', { keyPath: 'key' });
        }
        if (oldVersion < 2) {
          if (!db.objectStoreNames.contains('profiles')) {
            db.createObjectStore('profiles', { keyPath: 'key' });
          }
          if (!db.objectStoreNames.contains('recentTerrains')) {
            const recent = db.createObjectStore('recentTerrains', { keyPath: 'id' });
            recent.createIndex('by-viewed', 'viewedAt');
          }
        }
      },
    });
  }
  return dbPromise;
}

export async function cacheReservations(items: CachedReservation[]) {
  const db = await getDb();
  const tx = db.transaction('reservations', 'readwrite');
  await Promise.all([
    ...items.map((item) => tx.store.put({ ...item, syncedAt: Date.now() })),
    tx.done,
  ]);
}

export async function getCachedReservations(): Promise<CachedReservation[]> {
  const db = await getDb();
  const all = await db.getAll('reservations');
  return all.sort((a, b) => b.date.localeCompare(a.date));
}

export async function queuePendingReservation(
  payload: PendingReservation['payload'],
  token: string | null,
): Promise<string> {
  const db = await getDb();
  const id = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await db.put('pendingReservations', {
    id,
    payload,
    token,
    createdAt: Date.now(),
    status: 'pending',
  });
  return id;
}

export async function getPendingReservations(): Promise<PendingReservation[]> {
  const db = await getDb();
  return db.getAll('pendingReservations');
}

export async function removePendingReservation(id: string) {
  const db = await getDb();
  await db.delete('pendingReservations', id);
}

export async function cacheTerrainsList(key: string, data: unknown) {
  const db = await getDb();
  await db.put('terrainsCache', { key, data, syncedAt: Date.now() });
}

export async function getCachedTerrainsList(key: string): Promise<unknown | null> {
  const db = await getDb();
  const entry = await db.get('terrainsCache', key);
  return entry?.data ?? null;
}

/** Profil joueur / gérant — consultation instantanée hors-ligne */
export async function cacheProfile(role: string, data: unknown) {
  const db = await getDb();
  const key = `profile:${role}`;
  await db.put('profiles', { key, role, data, syncedAt: Date.now() });
}

export async function getCachedProfile(role: string): Promise<unknown | null> {
  const db = await getDb();
  const entry = await db.get('profiles', `profile:${role}`);
  return entry?.data ?? null;
}

/** Terrains récemment consultés (fiche) */
export async function cacheRecentTerrain(id: number | string, data: unknown) {
  const numericId = Number(id);
  if (!Number.isFinite(numericId)) return;
  const db = await getDb();
  await db.put('recentTerrains', { id: numericId, data, viewedAt: Date.now() });

  const all = await db.getAllFromIndex('recentTerrains', 'by-viewed');
  if (all.length > MAX_RECENT_TERRAINS) {
    const toRemove = all.slice(0, all.length - MAX_RECENT_TERRAINS);
    const tx = db.transaction('recentTerrains', 'readwrite');
    await Promise.all([...toRemove.map((row) => tx.store.delete(row.id)), tx.done]);
  }
}

export async function getRecentTerrains(limit = 10): Promise<CachedRecentTerrain[]> {
  const db = await getDb();
  const all = await db.getAllFromIndex('recentTerrains', 'by-viewed');
  return all.reverse().slice(0, limit);
}

export async function getCachedRecentTerrain(id: number | string): Promise<unknown | null> {
  const db = await getDb();
  const entry = await db.get('recentTerrains', Number(id));
  return entry?.data ?? null;
}

export function isOnline(): boolean {
  return typeof navigator !== 'undefined' ? navigator.onLine : true;
}
