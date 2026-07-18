const API_URL = import.meta.env.VITE_API_URL || '/api';

// Récupérer le token depuis le localStorage
function getToken(): string | null {
  return localStorage.getItem('terrainsn_token');
}

function setToken(token: string) {
  localStorage.setItem('terrainsn_token', token);
}

function removeToken() {
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

const TECHNICAL_ERROR_RE = /syntaxerror|sql\b|stack|paytech|whatsapp|<html|exception|traceback|econnrefused|errno/i;

function isTechnicalMessage(message: string): boolean {
  if (!message) return true;
  if (message.length > 180) return true;
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

  const path = endpoint.toLowerCase();
  const isAuth = path.includes('/auth') || path.includes('otp') || path.includes('login') || path.includes('password');
  const isPayment =
    path.includes('/paiement') ||
    path.includes('paytech') ||
    path.includes('/webhook/paytech') ||
    path.includes('simulate');
  const isQrScan = path.includes('/scanner');
  const isReservation = path.includes('/reservation');

  if (isPayment) {
    return "Le paiement n'a pas pu être confirmé. Veuillez réessayer.";
  }
  if (isQrScan && raw && !isTechnicalMessage(raw)) {
    return raw;
  }
  if (isAuth) {
    return 'Identifiants incorrects ou session expirée.';
  }
  if (isReservation) {
    return 'Impossible de finaliser la réservation. Veuillez réessayer.';
  }

  if (!raw || isTechnicalMessage(raw)) {
    return 'Une erreur est survenue. Veuillez réessayer.';
  }
  return raw;
}

// Requête générique
async function request(endpoint: string, options: RequestInit = {}) {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(`${API_URL}${endpoint}`, {
      ...options,
      headers,
    });
  } catch {
    throw new Error('Connexion au serveur impossible. Vérifiez votre connexion.');
  }

  if (res.status === 401) {
    removeToken();
    removeUser();
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
    };
    if (typeof data.code === 'string') err.code = data.code;
    if (typeof data.telephone === 'string') err.telephone = data.telephone;
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
    if (result.token) {
      setToken(result.token);
      setUser(result.user);
    }
    return result;
  },

  async login(data: { email?: string; telephone?: string; password: string; accountType?: string }) {
    const result = await request('/auth/login', { method: 'POST', body: JSON.stringify(data) });
    setToken(result.token);
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
    if (result.token) {
      setToken(result.token);
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

  logout() {
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
  async list(filters?: { ville?: string; type?: string; search?: string; prix_min?: number; prix_max?: number }) {
    const params = new URLSearchParams();
    if (filters) {
      Object.entries(filters).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
      });
    }
    const query = params.toString();
    return await request(`/terrains${query ? '?' + query : ''}`);
  },

  async get(id: number | string) {
    return await request(`/terrains/${id}`);
  },

  async getCreneaux(id: number | string, date: string) {
    return await request(`/terrains/${id}/creneaux?date=${date}`);
  },

  async create(data: any) {
    return await request('/terrains', { method: 'POST', body: JSON.stringify(data) });
  },

  async update(id: number | string, data: any) {
    return await request(`/terrains/${id}`, { method: 'PUT', body: JSON.stringify(data) });
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
    return await request('/reservations', { method: 'POST', body: JSON.stringify(data) });
  },

  async mes() {
    return await request('/reservations/mes');
  },

  async changePassword(password: string) {
    return await request('/auth/change-password', { method: 'POST', body: JSON.stringify({ password }) });
  },

  async get(id: number | string) {
    return await request(`/reservations/${id}`);
  },

  async createGerant(data: { terrain_id: number; date: string; heure_debut: string; heure_fin: string; joueur_nom: string; joueur_telephone: string; format_terrain?: 'moitie' | 'entier' }) {
    return await request('/reservations/gerant', { method: 'POST', body: JSON.stringify(data) });
  },

  async annuler(id: number | string) {
    return await request(`/reservations/${id}/annuler`, { method: 'PUT' });
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

  async santeTerrain(terrainId: number | string) {
    return await request(`/proprietaire/sante/${terrainId}`);
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

  async updateHoraires(horaires: any[]) {
    return await request('/gerant/horaires', { method: 'PUT', body: JSON.stringify({ horaires }) });
  },

  async addBlocage(data: any) {
    return await request('/gerant/blocages', { method: 'POST', body: JSON.stringify(data) });
  },

  async removeBlocage(id: number | string) {
    return await request(`/gerant/blocages/${id}`, { method: 'DELETE' });
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
