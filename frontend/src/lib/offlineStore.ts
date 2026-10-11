import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

/** Réservation mise en cache pour consultation hors-ligne (entrée stade). */
export interface CachedReservation {
  id: number;
  terrain_id: number;
  terrain_nom: string;
  terrain_ville?: string;
  adresse?: string;
  date: string;
  heure_debut: string;
  heure_fin: string;
  statut: string;
  prix_total?: number;
  montant?: number;
  montant_avance?: number;
  acompte?: number;
  reste_a_payer?: number;
  montant_restant?: number;
  code_reservation?: string | null;
  /** PNG encodé en data URL — utilisable sans réseau */
  qr_code_data_url?: string | null;
  /** URL serveur (réseau requis) — fallback online */
  qr_code_url?: string | null;
  created_at?: string;
  confirme_at?: string | null;
  verrou_expire_at?: number | null;
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
    format_terrain?: string;
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

const STATUTS_AVEC_ACCES = new Set(['confirme', 'acceptee']);

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

export function reservationHasStadiumAccess(statut: string | undefined | null): boolean {
  return STATUTS_AVEC_ACCES.has(String(statut || ''));
}

/** Normalise une réservation API vers le format cache hors-ligne. */
export function toCachedReservation(
  raw: Record<string, unknown>,
  previous?: CachedReservation | null,
): CachedReservation {
  const id = Number(raw.id);
  return {
    id,
    terrain_id: Number(raw.terrain_id),
    terrain_nom: String(raw.terrain_nom || previous?.terrain_nom || 'Terrain'),
    terrain_ville: (raw.terrain_ville as string) || previous?.terrain_ville,
    adresse: (raw.adresse as string) || previous?.adresse,
    date: String(raw.date || previous?.date || ''),
    heure_debut: String(raw.heure_debut || previous?.heure_debut || ''),
    heure_fin: String(raw.heure_fin || previous?.heure_fin || ''),
    statut: String(raw.statut || previous?.statut || ''),
    prix_total: numOrUndef(raw.prix_total) ?? previous?.prix_total,
    montant: numOrUndef(raw.montant) ?? previous?.montant,
    montant_avance: numOrUndef(raw.montant_avance) ?? previous?.montant_avance,
    acompte: numOrUndef(raw.acompte) ?? previous?.acompte,
    reste_a_payer: numOrUndef(raw.reste_a_payer) ?? previous?.reste_a_payer,
    montant_restant: numOrUndef(raw.montant_restant) ?? previous?.montant_restant,
    code_reservation:
      (raw.code_reservation as string | null | undefined) ?? previous?.code_reservation ?? null,
    qr_code_data_url:
      (raw.qr_code_data_url as string | null | undefined) || previous?.qr_code_data_url || null,
    qr_code_url: (raw.qr_code_url as string | null | undefined) ?? previous?.qr_code_url ?? null,
    created_at: (raw.created_at as string) || previous?.created_at,
    confirme_at: (raw.confirme_at as string | null) ?? previous?.confirme_at ?? null,
    verrou_expire_at: numOrUndef(raw.verrou_expire_at) ?? previous?.verrou_expire_at ?? null,
    syncedAt: Date.now(),
  };
}

function numOrUndef(v: unknown): number | undefined {
  if (v == null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** Remplace le cache réservations en préservant les QR déjà téléchargés. */
export async function cacheReservations(items: CachedReservation[]) {
  const db = await getDb();
  const existing = await db.getAll('reservations');
  const byId = new Map(existing.map((row) => [row.id, row]));
  const keepIds = new Set(items.map((item) => item.id));

  const tx = db.transaction('reservations', 'readwrite');
  await Promise.all([
    ...existing
      .filter((row) => !keepIds.has(row.id))
      .map((row) => tx.store.delete(row.id)),
    ...items.map((item) => {
      const prev = byId.get(item.id);
      const merged = toCachedReservation(item as unknown as Record<string, unknown>, prev);
      return tx.store.put(merged);
    }),
    tx.done,
  ]);
}

export async function getCachedReservations(): Promise<CachedReservation[]> {
  const db = await getDb();
  const all = await db.getAll('reservations');
  return all.sort((a, b) => b.date.localeCompare(a.date));
}

export async function getCachedReservation(id: number): Promise<CachedReservation | null> {
  const db = await getDb();
  return (await db.get('reservations', id)) ?? null;
}

/** Met à jour le QR (data URL) d'une réservation déjà en cache, ou l'upsert. */
export async function cacheReservationAccessPass(
  reservation: Record<string, unknown>,
  qrDataUrl?: string | null,
) {
  const db = await getDb();
  const id = Number(reservation.id);
  if (!Number.isFinite(id)) return;
  const previous = (await db.get('reservations', id)) ?? null;
  const merged = toCachedReservation(
    {
      ...reservation,
      qr_code_data_url: qrDataUrl || reservation.qr_code_data_url || previous?.qr_code_data_url,
    },
    previous,
  );
  await db.put('reservations', merged);
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

/** Retire les data URL lourdes avant persistance localStorage. */
export function stripQrDataUrls<T extends { qr_code_data_url?: string | null }>(list: T[]): T[] {
  return list.map((row) => {
    if (!row?.qr_code_data_url) return row;
    const { qr_code_data_url: _drop, ...rest } = row;
    return rest as T;
  });
}
