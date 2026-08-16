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
}

const DB_NAME = 'terrainsn-offline';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<TerrainSNDB>> | null = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB<TerrainSNDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const reservations = db.createObjectStore('reservations', { keyPath: 'id' });
        reservations.createIndex('by-date', 'date');

        db.createObjectStore('pendingReservations', { keyPath: 'id' });
        db.createObjectStore('terrainsCache', { keyPath: 'key' });
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

export function isOnline(): boolean {
  return typeof navigator !== 'undefined' ? navigator.onLine : true;
}
