import {
  cacheReservations,
  getCachedReservations,
  queuePendingReservation,
  cacheTerrainsList,
  getCachedTerrainsList,
  isOnline,
  type CachedReservation,
} from './offlineStore';
import type { OperationalStage } from './kanbanRules';
import { WHATSAPP_INFRA_MESSAGE } from './whatsappMessages';
import { registerBackgroundSync } from './pwaRegister';

const API_URL = import.meta.env.VITE_API_URL || '/api';

// Récupérer le token depuis le localStorage
function getToken(): string | null {
  return localStorage.getItem('terrainsn_token') || localStorage.getItem('access_token');
}

function setToken(token: string) {
  localStorage.setItem('access_token', token);
  localStorage.setItem('terrainsn_token', token);
}

function removeToken() {
  localStorage.removeItem('access_token');
  localStorage.removeItem('terrainsn_token');
}

function setUser(user: any) {
  localStorage.setItem('terrainsn_user', JSON.stringify(user));
}

function getUser(): any | null {
  const raw = localStorage.getItem('terrainsn_user');
  return raw ? JSON.parse(raw) : null;
}

function removeUser() {
  localStorage.removeItem('terrainsn_user');
}

const GERANT_TERRAIN_KEY = 'gerant_terrain_actif';

export function getGerantTerrainActif(): number | null {
  const raw = localStorage.getItem(GERANT_TERRAIN_KEY);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function setGerantTerrainActif(terrainId: number | string | null) {
  if (terrainId == null || terrainId === '') {
    localStorage.removeItem(GERANT_TERRAIN_KEY);
    return;
  }
  localStorage.setItem(GERANT_TERRAIN_KEY, String(terrainId));
  window.dispatchEvent(new CustomEvent('gerant-terrain-changed', { detail: Number(terrainId) }));
}

const TECHNICAL_ERROR_RE = /syntaxerror|sql\b|stack|paytech|<html|exception|traceback|econnrefused|errno/i;
const WHATSAPP_USER_ERROR_RE = /whatsapp non connect|numero whatsapp|envoi whatsapp|lien whatsapp|problème avec whatsapp|paramètres pour le lier/i;

function isTechnicalMessage(message: string): boolean {
  if (!message) return true;
  if (message.length > 180) return true;
  if (WHATSAPP_USER_ERROR_RE.test(message)) return false;
  return TECHNICAL_ERROR_RE.test(message);
}

/** Messages client sûrs — jamais de détail technique brut. */
function normalizeClientError(endpoint: string, status: number, data: unknown): string {
  const raw = typeof (data as { error?: unknown })?.error === 'string'
    ? String((data as { error: string }).error).trim()
    : '';

  if (status === 429 || /trop de tentatives/i.test(raw)) {
    return 'Trop de tentatives. Réessayez dans quelques minutes.';
  }

  if (/suspendu|bloque|bloqué/i.test(raw)) {
    return raw;
  }

  const path = endpoint.toLowerCase();
  const isAuth = path.includes('/auth') || path.includes('otp') || path.includes('login') || path.includes('password');
  const isPayment =
    path.includes('/paiement') ||
    path.includes('paytech') ||
    path.includes('/webhook/paytech') ||
    path.includes('simulate');
  const isQrScan = path.includes('/scanner') || path.includes('/scan-qr');
  const isGerantRoute =
    path.includes('/gerant/') ||
    path.includes('/renvoyer-lien') ||
    path.includes('/renvoyer-confirmation') ||
    path.includes('/reservations/gerant');
  const isReservation = path.includes('/reservation') && !isQrScan && !isGerantRoute;

  if (isPayment) {
    return "Le paiement n'a pas pu être confirmé. Veuillez réessayer.";
  }
  if ((isQrScan || isGerantRoute) && raw && !isTechnicalMessage(raw)) {
    return raw;
  }
  if (/openwa|chromium|puppeteer|engine_type|mywa\.tickets|pthread_create/i.test(raw) || path.includes('whatsapp')) {
    if (WHATSAPP_USER_ERROR_RE.test(raw) && !/openwa|chromium|puppeteer|engine_type/i.test(raw)) {
      return raw;
    }
    return WHATSAPP_INFRA_MESSAGE;
  }
  if (isAuth) {
    return 'Identifiants incorrects ou session expirée.';
  }
  if (isReservation) {
    if (status === 409 && raw && !isTechnicalMessage(raw)) return raw;
    return 'Impossible de finaliser la réservation. Veuillez réessayer.';
  }

  if (status === 409 && raw && !isTechnicalMessage(raw)) return raw;

  if (!raw || isTechnicalMessage(raw)) {
    return 'Une erreur est survenue. Veuillez réessayer.';
  }
  return raw;
}

let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      const res = await fetch(`${API_URL}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        removeToken();
        removeUser();
        return null;
      }
      const data = await res.json();
      const next = data.accessToken || data.token;
      if (!next) {
        removeToken();
        removeUser();
        return null;
      }
      setToken(next);
      return next as string;
    } catch {
      removeToken();
      removeUser();
      return null;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

function parseJwtExp(token: string): number | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

// Requête générique
async function request(endpoint: string, options: RequestInit = {}, retried = false): Promise<any> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const terrainActif = getGerantTerrainActif();
  if (terrainActif && !headers['X-Terrain-Id']) {
    headers['X-Terrain-Id'] = String(terrainActif);
  }

  let res: Response;
  try {
    res = await fetch(`${API_URL}${endpoint}`, {
      cache: 'no-store',
      ...options,
      headers,
      credentials: 'include',
    });
  } catch (err) {
    if (options.method === 'GET' || !options.method) {
      throw new Error('Connexion au serveur impossible. Vérifiez votre connexion.');
    }
    throw err;
  }

  if (res.status === 401) {
    let data: Record<string, unknown> = {};
    try {
      data = await res.clone().json();
    } catch {
      data = {};
    }
    const isExpire = data.error === 'TOKEN_EXPIRE' || !retried;
    if (!retried && endpoint !== '/auth/refresh' && endpoint !== '/auth/login' && isExpire) {
      const next = await refreshAccessToken();
      if (next) {
        return request(endpoint, options, true);
      }
    }
    if (endpoint !== '/auth/refresh' && endpoint !== '/auth/login') {
      removeToken();
      removeUser();
    }
  }

  let data: Record<string, unknown> = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }

  if (!res.ok) {
    const err = new Error(normalizeClientError(endpoint, res.status, data)) as Error & {
      code?: string;
      telephone?: string;
      status?: number;
      scannable_at?: string;
      minutes_remaining?: number;
      match_date?: string;
      match_time?: string;
      qr_code_scanne_at?: string;
      priorite_reservation_id?: number;
      priorite_heure?: string;
      priorite_joueur?: string;
    };
    if (typeof data.code === 'string') err.code = data.code;
    if (typeof data.telephone === 'string') err.telephone = data.telephone;
    if (typeof data.scannable_at === 'string') err.scannable_at = data.scannable_at;
    if (typeof data.minutes_remaining === 'number') err.minutes_remaining = data.minutes_remaining;
    if (typeof data.match_date === 'string') err.match_date = data.match_date;
    if (typeof data.match_time === 'string') err.match_time = data.match_time;
    if (typeof data.qr_code_scanne_at === 'string') err.qr_code_scanne_at = data.qr_code_scanne_at;
    if (typeof data.priorite_reservation_id === 'number') err.priorite_reservation_id = data.priorite_reservation_id;
    if (typeof data.priorite_heure === 'string') err.priorite_heure = data.priorite_heure;
    if (typeof data.priorite_joueur === 'string') err.priorite_joueur = data.priorite_joueur;
    err.status = res.status;
    throw err;
  }
  return data;
}

// ============================================================
// AUTH
// ============================================================
export const authApi = {
  async register(data: { nom: string; email: string; password: string; telephone: string }) {
    // Legacy — préférer registerJoueur (OTP). Ne stocke un token que s'il est renvoyé.
    const result = await request('/auth/register', { method: 'POST', body: JSON.stringify(data) });
    if (result.token || result.accessToken) {
      setToken(result.accessToken || result.token);
      setUser(result.user);
    }
    return result;
  },

  async login(data: { email?: string; telephone?: string; password: string; accountType?: string }) {
    const result = await request('/auth/login', { method: 'POST', body: JSON.stringify(data) });
    setToken(result.accessToken || result.token);
    setUser(result.user);
    localStorage.removeItem('admin_token');
    localStorage.removeItem('admin_user');
    return result;
  },

  /** Login unique : téléphone (ou email) + mot de passe, sans accountType. */
  async smartLogin(identifier: string, password: string) {
    const trimmed = identifier.trim();
    const isEmail = trimmed.includes('@');
    const payload = isEmail
      ? { email: trimmed, password }
      : { telephone: trimmed, password };
    return this.login(payload);
  },

  async registerJoueur(data: { prenom: string; nom: string; telephone: string; password: string }) {
    return await request('/auth/register', { method: 'POST', body: JSON.stringify(data) });
  },

  async verifyOtp(data: { telephone: string; code: string }) {
    const result = await request('/auth/verify-otp', { method: 'POST', body: JSON.stringify(data) });
    if (result.token || result.accessToken) {
      setToken(result.accessToken || result.token);
      setUser(result.user);
      localStorage.removeItem('admin_token');
      localStorage.removeItem('admin_user');
    }
    return result;
  },

  async resendOtp(telephone: string) {
    return await request('/auth/resend-otp', { method: 'POST', body: JSON.stringify({ telephone }) });
  },

  async me() {
    return await request('/auth/me');
  },

  async changePassword(password: string) {
    return await request('/auth/change-password', { method: 'POST', body: JSON.stringify({ password }) });
  },

  async refresh() {
    return refreshAccessToken();
  },

  async restoreSession(): Promise<any | null> {
    const token = getToken();
    if (!token) {
      // Tentative refresh cookie silencieux (PWA / nouvel onglet)
      const refreshed = await refreshAccessToken();
      if (!refreshed) return null;
      return this.me();
    }
    const exp = parseJwtExp(token);
    const now = Date.now() / 1000;
    if (exp && exp > now + 30) {
      try {
        return await this.me();
      } catch {
        const refreshed = await refreshAccessToken();
        if (!refreshed) return null;
        return this.me();
      }
    }
    const refreshed = await refreshAccessToken();
    if (!refreshed) return null;
    return this.me();
  },

  async logout() {
    try {
      await request('/auth/logout', { method: 'POST' });
    } catch {
      // ignore — nettoyage local de toute façon
    }
    removeToken();
    removeUser();
    localStorage.removeItem('admin_token');
    localStorage.removeItem('admin_user');
  },

  isAuthenticated() {
    return !!getToken();
  },

  getUser,
  getToken,
};

// ============================================================
// TERRAINS
// ============================================================
export const terrainsApi = {
  async list(filters?: {
    ville?: string;
    type?: string;
    search?: string;
    prix_min?: number;
    prix_max?: number;
    lat?: number;
    lng?: number;
    distance_max?: number;
    quartier?: string;
    /** Filtre via description (surface admin) */
    surface?: string;
    date?: string;
    /** Dates CSV pour week-end (ex: 2026-08-15,2026-08-16) */
    dates?: string;
    heure?: string;
  }) {
    const params = new URLSearchParams();
    if (filters) {
      Object.entries(filters).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
      });
    }
    const query = params.toString();
    const cacheKey = `terrains-list:${query || 'all'}`;

    try {
      const data = await request(`/terrains${query ? '?' + query : ''}`);
      const list = Array.isArray(data) ? data : [];
      await cacheTerrainsList(cacheKey, list);
      return list;
    } catch (err) {
      const cached = await getCachedTerrainsList(cacheKey);
      if (cached) return cached;
      throw err;
    }
  },

  async get(id: number | string) {
    return await request(`/terrains/${id}`);
  },

  async getCreneaux(id: number | string, date: string, opts?: { duree_minutes?: number }) {
    const q = new URLSearchParams({ date });
    if (opts?.duree_minutes != null) q.set("duree_minutes", String(opts.duree_minutes));
    return await request(`/terrains/${id}/creneaux?${q.toString()}`);
  },

  async getDevis(
    id: number | string,
    params: { date: string; heure_debut: string; heure_fin: string; format?: 'moitie' | 'entier' },
  ) {
    const q = new URLSearchParams({
      date: params.date,
      heure_debut: params.heure_debut,
      heure_fin: params.heure_fin,
      format: params.format || 'entier',
    });
    return await request(`/terrains/${id}/devis?${q.toString()}`);
  },

  async create(data: any) {
    return await request('/terrains', { method: 'POST', body: JSON.stringify(data) });
  },

  async update(id: number | string, data: any) {
    return await request(`/terrains/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  },

  async updateHoraires(id: number | string, horaires: any[]) {
    return await request(`/terrains/${id}/horaires`, { method: 'PUT', body: JSON.stringify({ horaires }) });
  },

  async remove(id: number | string) {
    return await request(`/terrains/${id}`, { method: 'DELETE' });
  },

  async listPhotos(id: number | string) {
    return await request(`/terrains/${id}/photos`);
  },

  async uploadPhoto(id: number | string, data: { dataUrl: string; est_principale?: boolean; ordre?: number }) {
    return await request(`/terrains/${id}/photos`, { method: 'POST', body: JSON.stringify(data) });
  },

  async updatePhoto(id: number | string, photoId: number | string, data: { est_principale?: boolean; ordre?: number }) {
    return await request(`/terrains/${id}/photos/${photoId}`, { method: 'PATCH', body: JSON.stringify(data) });
  },

  async removePhoto(id: number | string, photoId: number | string) {
    return await request(`/terrains/${id}/photos/${photoId}`, { method: 'DELETE' });
  },
};

// ============================================================
// RESERVATIONS
// ============================================================
export const reservationsApi = {
  async create(data: { terrain_id: number; date: string; heure_debut: string; heure_fin: string; joueur_nom: string; joueur_telephone: string; format_terrain?: 'moitie' | 'entier' }) {
    try {
      return await request('/reservations', { method: 'POST', body: JSON.stringify(data) });
    } catch (err) {
      if (!isOnline()) {
        const pendingId = await queuePendingReservation(data, getToken());
        await registerBackgroundSync();
        const offlineErr = new Error(
          'Réservation enregistrée hors-ligne. Elle sera envoyée dès que la connexion reviendra.',
        ) as Error & { offline?: boolean; pendingId?: string };
        offlineErr.offline = true;
        offlineErr.pendingId = pendingId;
        throw offlineErr;
      }
      throw err;
    }
  },

  async mes() {
    try {
      const data = await request('/reservations/mes');
      if (Array.isArray(data) && data.length > 0) {
        await cacheReservations(data as CachedReservation[]);
      }
      return data;
    } catch (err) {
      const cached = await getCachedReservations();
      if (cached.length > 0) return cached;
      throw err;
    }
  },

  async changePassword(password: string) {
    return await request('/auth/change-password', { method: 'POST', body: JSON.stringify({ password }) });
  },

  async get(id: number | string) {
    return await request(`/reservations/${id}`);
  },

  async createGerant(data: {
    terrain_id: number;
    date: string;
    heure_debut: string;
    heure_fin: string;
    joueur_nom: string;
    joueur_prenom?: string;
    joueur_telephone?: string;
    format_terrain?: 'moitie' | 'entier';
    joueur_id?: number;
    mode?: 'paiement' | 'bloquer' | 'manuel';
    anonyme?: boolean;
  }) {
    return await request('/reservations/gerant', { method: 'POST', body: JSON.stringify(data) });
  },

  async verifierDisponibilite(data: {
    terrain_id: number;
    date: string;
    heure_debut: string;
    heure_fin: string;
    exclure_reservation_id?: number;
  }) {
    return await request('/reservations/verifier-disponibilite', {
      method: 'POST',
      body: JSON.stringify(data),
    }) as {
      disponible: boolean;
      duree_minutes?: number;
      duree_label?: string;
      conflits?: Array<{
        heure_debut: string;
        heure_fin: string;
        duree_minutes?: number;
        joueur_nom?: string | null;
      }>;
    };
  },

  async renvoyerLienWhatsApp(id: number | string) {
    return await request(`/reservations/${id}/renvoyer-lien`, { method: 'POST' });
  },

  async renvoyerConfirmationWhatsApp(id: number | string) {
    return await request(`/reservations/${id}/renvoyer-confirmation`, { method: 'POST' });
  },

  async annuler(id: number | string) {
    return await request(`/reservations/${id}/annuler`, { method: 'PUT' });
  },

  async politiqueAnnulation(id: number | string) {
    return await request(`/reservations/${id}/politique-annulation`);
  },

  async annulerGerant(id: number | string) {
    return await request(`/gerant/reservations/${id}/annuler`, { method: 'PATCH' });
  },

  async traiter(id: number | string, action: 'acceptee' | 'refusee') {
    return await request(`/reservations/${id}/traiter`, { method: 'PUT', body: JSON.stringify({ action }) });
  },

  async parTerrain(terrainId: number | string) {
    return await request(`/reservations/terrain/${terrainId}`);
  },

  async marquerJoue(id: number | string, methode: 'especes' | 'wave' | 'orange_money' = 'especes') {
    return await request(`/gerant/reservations/${id}/scanner`, { method: 'PATCH', body: JSON.stringify({ methode }) });
  },
};

// ============================================================
// PAIEMENTS
// ============================================================
export const paiementsApi = {
  async create(data: { reservation_id: number; methode: string; telephone?: string }) {
    return await request('/paiements', { method: 'POST', body: JSON.stringify(data) });
  },

  async marquerJoue(id: number | string, methode: 'especes' | 'wave' | 'orange_money' = 'especes') {
    return await request(`/gerant/reservations/${id}/scanner`, { method: 'PATCH', body: JSON.stringify({ methode }) });
  },

  async mockComplete(data: { reservation_id: number; ref_command: string; action: 'success' | 'cancel' }) {
    return await request('/paytech/mock/complete', { method: 'POST', body: JSON.stringify(data) });
  },

  async simulateComplete(data: { reservation_id: number; ref_command: string; action: 'success' | 'cancel' | 'failed' }) {
    return await request('/webhook/paytech/simulate', { method: 'POST', body: JSON.stringify(data) });
  },
};

// ============================================================
// PROPRIETAIRE
// ============================================================
export const proprietaireApi = {
  async profile() {
    return await request('/proprietaire/profile');
  },

  async stats() {
    return await request('/proprietaire/stats');
  },

  async terrains() {
    return await request('/proprietaire/terrains');
  },

  async reservations() {
    return await request('/proprietaire/reservations');
  },

  async revenus(periode: 'semaine' | 'mois' | 'annee' = 'mois') {
    return await request(`/proprietaire/revenus?periode=${periode}`);
  },

  async finances(periode: 'aujourd_hui' | 'semaine' | 'mois' | 'annee' = 'aujourd_hui', terrainId?: number | string) {
    const sp = new URLSearchParams({ periode });
    if (terrainId != null && terrainId !== '' && terrainId !== 'all') sp.set('terrain_id', String(terrainId));
    return await request(`/proprietaire/finances?${sp.toString()}`);
  },

  async santeTerrain(terrainId: number | string) {
    return await request(`/proprietaire/sante/${terrainId}`);
  },

  async confirmerAvance(reservationId: number | string) {
    return await request(`/proprietaire/reservations/${reservationId}/confirmer-avance`, {
      method: 'POST',
    });
  },

  async getTarifs(terrainId: number | string) {
    return await request(`/proprietaire/terrains/${terrainId}/tarifs`);
  },

  async proposerTarifs(terrainId: number | string, data: unknown) {
    return await request(`/proprietaire/terrains/${terrainId}/tarifs/proposition`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
};

// ============================================================
// EMPLOYES
// ============================================================
export const employesApi = {
  async list() {
    return await request('/employes');
  },

  async create(data: any) {
    return await request('/employes', { method: 'POST', body: JSON.stringify(data) });
  },

  async remove(id: number | string) {
    return await request(`/employes/${id}`, { method: 'DELETE' });
  },
};

// ============================================================
// GERANT
// ============================================================
export const gerantApi = {
  async dashboard() {
    return await request('/gerant/dashboard');
  },

  async terrains() {
    return await request('/gerant/terrains') as {
      terrains: Array<{
        id: number;
        nom: string;
        adresse?: string;
        ville?: string;
        est_principal?: number;
        note?: string | null;
      }>;
      terrain_actif: number | null;
      terrains_ids: number[];
    };
  },

  async planning() {
    return await request('/gerant/planning');
  },

  async heartbeat(terrainId?: number) {
    return await request('/gerant/heartbeat', {
      method: 'POST',
      body: JSON.stringify(terrainId != null ? { terrain_id: terrainId } : {}),
    }) as { ok: boolean; autres_gerants?: Array<{ gerant_id: number; prenom?: string; nom?: string }> };
  },

  async gerantsEnLigne(terrainId: number) {
    return await request(`/gerant/terrain/${terrainId}/gerants-en-ligne`) as {
      gerants: Array<{ gerant_id: number; prenom?: string; nom?: string }>;
    };
  },

  async reservationsToday(date?: string) {
    const q = date ? `?date=${encodeURIComponent(date)}` : '';
    return await request(`/gerant/reservations/today${q}`);
  },

  async reservationsWeek() {
    return await request('/gerant/reservations/week');
  },

  async reservationsList(params?: { statut?: string; q?: string }) {
    const sp = new URLSearchParams();
    if (params?.statut) sp.set('statut', params.statut);
    if (params?.q) sp.set('q', params.q);
    const q = sp.toString();
    return await request(`/gerant/reservations${q ? `?${q}` : ''}`);
  },

  async reservationDetail(id: number | string) {
    return await request(`/gerant/reservations/${id}`);
  },

  async patchReservationStage(
    id: number | string,
    body: { stage: OperationalStage; waiverEncaissement?: boolean; encaisserRestant?: boolean; methode?: 'especes' | 'wave' | 'orange_money' },
  ) {
    return await request(`/gerant/reservations/${id}/stage`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  },

  async joueurs(params?: { q?: string; filter?: string }) {
    const sp = new URLSearchParams();
    if (params?.q) sp.set('q', params.q);
    if (params?.filter) sp.set('filter', params.filter);
    const q = sp.toString();
    return await request(`/gerant/joueurs${q ? `?${q}` : ''}`);
  },

  async joueurByTelephone(numero: string) {
    return await request(`/joueurs/telephone/${encodeURIComponent(numero)}`) as {
      trouve: boolean;
      joueur: {
        id: number;
        nom: string | null;
        prenom: string | null;
        display_nom: string;
        telephone: string | null;
      } | null;
    };
  },

  async joueurDetail(id: number | string) {
    return await request(`/gerant/joueurs/${id}`);
  },

  async patchJoueur(
    id: number | string,
    body: { is_banned?: boolean; banned_reason?: string; notes_internes?: string },
  ) {
    return await request(`/gerant/joueurs/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  },

  async createJoueur(body: { nom: string; telephone?: string }) {
    return await request('/gerant/joueurs', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  async lierJoueurReservation(
    reservationId: number | string,
    body: { joueur_id?: number; nom?: string; telephone?: string },
  ) {
    return await request(`/gerant/reservations/${reservationId}/lier-joueur`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  async scanQr(
    id: number | string,
    methode: 'especes' | 'wave' | 'orange_money' = 'especes',
    qr_data?: string,
  ) {
    return await request(`/reservations/${id}/scan-qr`, {
      method: 'POST',
      body: JSON.stringify({ methode, qr_data }),
    });
  },

  async reservationByCode(code: string) {
    const safe = encodeURIComponent(String(code || '').trim().toUpperCase());
    return await request(`/gerant/reservations/by-code/${safe}`);
  },

  async encaisserRestant(
    id: number | string,
    methode: 'especes' | 'wave' | 'orange_money' = 'especes',
  ) {
    return await request(`/gerant/reservations/${id}/encaisser`, {
      method: 'POST',
      body: JSON.stringify({ methode }),
    });
  },

  async portefeuille() {
    return await request('/gerant/portefeuille');
  },

  async finances(periode: 'aujourd_hui' | 'semaine' | 'mois' | 'annee' = 'aujourd_hui') {
    return await request(`/gerant/finances?periode=${encodeURIComponent(periode)}`);
  },

  async dettes() {
    return await request('/gerant/dettes');
  },

  async confirmerManuellement(id: number | string, note?: string) {
    return await request(`/gerant/reservations/${id}/confirmer-manuellement`, {
      method: 'POST',
      body: JSON.stringify({ note }),
    });
  },

  async whatsappStatus() {
    return await request('/gerant/whatsapp/status');
  },

  async whatsappConnect(opts?: { force?: boolean }) {
    return await request('/gerant/whatsapp/connect', {
      method: 'POST',
      body: JSON.stringify({ force: Boolean(opts?.force) }),
    });
  },

  async whatsappQr() {
    return await request('/gerant/whatsapp/qr');
  },

  async whatsappDisconnect() {
    return await request('/gerant/whatsapp/disconnect', { method: 'POST' });
  },

  async terrainCommodites() {
    return await request('/gerant/terrain/commodites');
  },

  async patchTerrainCommodites(commodite_ids: number[]) {
    return await request('/gerant/terrain/commodites', {
      method: 'PATCH',
      body: JSON.stringify({ commodite_ids }),
    });
  },

  async terrainPhotos() {
    return await request('/gerant/terrain/photos');
  },

  async uploadTerrainPhoto(file: File, estPrincipale = false) {
    const form = new FormData();
    form.append('photos', file);
    if (estPrincipale) form.append('est_principale', 'true');
    const token = getToken();
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    const terrainActif = getGerantTerrainActif();
    if (terrainActif) headers['X-Terrain-Id'] = String(terrainActif);
    const res = await fetch(`${API_URL}/gerant/terrain/photos`, {
      method: 'POST',
      body: form,
      headers,
      credentials: 'include',
      cache: 'no-store',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as { error?: string }).error || 'Upload impossible');
    return data;
  },

  async deleteTerrainPhoto(id: number) {
    return await request(`/gerant/terrain/photos/${id}`, { method: 'DELETE' });
  },

  async setTerrainPhotoPrincipale(id: number) {
    return await request(`/gerant/terrain/photos/${id}/principale`, { method: 'PATCH' });
  },

  async updateHoraires(horaires: any[]) {
    return await request('/gerant/horaires', { method: 'PUT', body: JSON.stringify({ horaires }) });
  },

  async addBlocage(data: any) {
    return await request('/gerant/blocages', { method: 'POST', body: JSON.stringify(data) });
  },

  async addBlocagesBatch(data: {
    date: string;
    motif?: string | null;
    creneaux: Array<{ heure_debut: string; heure_fin: string }>;
  }) {
    return await request('/gerant/blocages/batch', { method: 'POST', body: JSON.stringify(data) });
  },

  async addBlocageAbonnement(data: {
    libelle: string;
    date_debut: string;
    date_fin: string;
    heure_debut: string;
    heure_fin: string;
    jours: string[];
    montant_mensuel_abonnement?: number | null;
  }) {
    return await request('/gerant/blocages/abonnement', { method: 'POST', body: JSON.stringify(data) });
  },

  async addBlocageTournoi(data: {
    libelle: string;
    date_debut: string;
    date_fin: string;
    heure_debut?: string;
    heure_fin?: string;
    jours?: string[];
    creneaux?: Array<{ heure_debut: string; heure_fin: string }>;
    montant_tournoi?: number | null;
  }) {
    return await request('/gerant/blocages/tournoi', { method: 'POST', body: JSON.stringify(data) });
  },

  async listBlocageGroupes(type?: "ABONNEMENT" | "TOURNOI") {
    const q = type ? `?type=${encodeURIComponent(type)}` : "";
    return await request(`/gerant/blocages/groupes${q}`);
  },

  async getBlocageGroupe(id: string) {
    return await request(`/gerant/blocages/groupes/${id}`);
  },

  async encaisserBlocageGroupe(
    id: string,
    data: { montant: number; date_encaissement?: string; note?: string },
  ) {
    return await request(`/gerant/blocages/groupes/${id}/encaisser`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  },

  async removeBlocageGroupe(id: string) {
    return await request(`/gerant/blocages/groupes/${id}`, { method: 'DELETE' });
  },

  async removeBlocage(id: number | string) {
    return await request(`/gerant/blocages/${id}`, { method: 'DELETE' });
  },

  async removeBlocages(ids: number[]) {
    return await request('/gerant/blocages/debloquer', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    });
  },

  async getTarifs() {
    return await request('/gerant/tarifs');
  },

  async proposerTarifs(data: unknown) {
    return await request('/gerant/tarifs/proposition', { method: 'POST', body: JSON.stringify(data) });
  },

  async getDevis(params: {
    date: string;
    heure_debut: string;
    heure_fin: string;
    format?: 'moitie' | 'entier';
  }) {
    const q = new URLSearchParams({
      date: params.date,
      heure_debut: params.heure_debut,
      heure_fin: params.heure_fin,
      format: params.format || 'entier',
    });
    return await request(`/gerant/devis?${q.toString()}`);
  },

  async saveTarifs(data: {
    prix_entier_base: number;
    prix_moitie_base: number;
    cellules?: Array<{ jour: string; heure: number; prix_entier: number; prix_moitie: number }>;
  }) {
    return await request('/gerant/tarifs', { method: 'PUT', body: JSON.stringify(data) });
  },

  async getFenetreRetard() {
    return await request('/gerant/fenetre-retard');
  },

  async saveFenetreRetard(fenetre_retard: number) {
    return await request('/gerant/fenetre-retard', {
      method: 'PUT',
      body: JSON.stringify({ fenetre_retard }),
    });
  },
};

// ============================================================
// AVIS
// ============================================================
export const avisApi = {
  async create(data: { terrain_id: number; note: number; commentaire: string; reservation_id?: number }) {
    return await request('/avis', { method: 'POST', body: JSON.stringify(data) });
  },

  async parTerrain(terrainId: number | string) {
    return await request(`/avis/terrain/${terrainId}`);
  },
};

// ============================================================
// NOTIFICATIONS
// ============================================================
export const notificationsApi = {
  async list() {
    return await request('/notifications');
  },

  async marquerLue(id: number | string) {
    return await request(`/notifications/${id}/lire`, { method: 'PUT' });
  },
};

// ============================================================
// WEB PUSH
// ============================================================
export const pushApi = {
  async getVapidPublicKey() {
    return await request('/push/vapid-public-key');
  },

  async getPreferences() {
    return await request('/push/preferences');
  },

  async updatePreferences(prefs: Record<string, boolean>) {
    return await request('/push/preferences', { method: 'PUT', body: JSON.stringify(prefs) });
  },

  async subscribe(subscription: PushSubscriptionJSON) {
    return await request('/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription }) });
  },

  async unsubscribe(endpoint: string) {
    return await request('/push/unsubscribe', { method: 'DELETE', body: JSON.stringify({ endpoint }) });
  },
};

// ============================================================
// ADMIN
// ============================================================
export const adminApi = {
  async stats() {
    return await request('/admin/stats');
  },

  async updateProprietaire(id: number | string, data: any) {
    return await request(`/admin/proprietaires/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  },

  async auditLogs() {
    return await request('/admin/audit');
  },
};

// ============================================================
// PROFIL
// ============================================================
export const profilApi = {
  async get() {
    return await request('/profil');
  },

  async getJoueur() {
    return await request('/profil/joueur');
  },

  async getGerant() {
    return await request('/profil/gerant');
  },

  async getProprietaire() {
    return await request('/profil/proprietaire');
  },

  async getAdmin() {
    return await request('/profil/admin');
  },

  async update(data: {
    prenom?: string;
    nom: string;
    quartier?: string;
    date_naissance?: string;
    bio?: string;
  }) {
    return await request('/profil', { method: 'PUT', body: JSON.stringify(data) });
  },

  async updateJoueur(data: { prenom?: string; nom: string; quartier?: string; date_naissance?: string }) {
    return await request('/profil/joueur', { method: 'PATCH', body: JSON.stringify(data) });
  },

  async updateAdmin(data: { prenom?: string; nom: string; email: string }) {
    return await request('/profil/admin', { method: 'PATCH', body: JSON.stringify(data) });
  },

  async uploadPhoto(dataUrl: string) {
    return await request('/profil/photo', { method: 'PATCH', body: JSON.stringify({ dataUrl }) });
  },

  async changePassword(data: { old_password?: string; new_password: string; confirm_password: string }) {
    return await request('/profil/password', { method: 'PATCH', body: JSON.stringify(data) });
  },
};
