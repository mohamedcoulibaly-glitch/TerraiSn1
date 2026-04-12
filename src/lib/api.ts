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

  const res = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers,
  });

  if (res.status === 401) {
    removeToken();
    removeUser();
  }

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Erreur serveur');
  }
  return data;
}

// ============================================================
// AUTH
// ============================================================
export const authApi = {
  async register(data: { nom: string; email: string; password: string; telephone: string }) {
    const result = await request('/auth/register', { method: 'POST', body: JSON.stringify(data) });
    setToken(result.token);
    setUser(result.user);
    return result;
  },

  async login(data: { email: string; password: string; accountType?: string }) {
    const result = await request('/auth/login', { method: 'POST', body: JSON.stringify(data) });
    setToken(result.token);
    setUser(result.user);
    return result;
  },

  async me() {
    return await request('/auth/me');
  },

  logout() {
    removeToken();
    removeUser();
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
};

// ============================================================
// RESERVATIONS
// ============================================================
export const reservationsApi = {
  async create(data: { terrain_id: number; date: string; heure_debut: string; heure_fin: string; joueur_nom: string; joueur_telephone: string }) {
    return await request('/reservations', { method: 'POST', body: JSON.stringify(data) });
  },

  async mes() {
    return await request('/reservations/mes');
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
};

// ============================================================
// PAIEMENTS
// ============================================================
export const paiementsApi = {
  async create(data: { reservation_id: number; methode: string; telephone?: string }) {
    return await request('/paiements', { method: 'POST', body: JSON.stringify(data) });
  },
};

// ============================================================
// PROPRIETAIRE
// ============================================================
export const proprietaireApi = {
  async stats() {
    return await request('/proprietaire/stats');
  },

  async terrains() {
    return await request('/proprietaire/terrains');
  },

  async reservations() {
    return await request('/proprietaire/reservations');
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
  async update(data: { nom: string; telephone: string }) {
    return await request('/profil', { method: 'PUT', body: JSON.stringify(data) });
  },
};
