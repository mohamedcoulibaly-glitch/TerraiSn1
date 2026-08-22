import { authApi } from "@/lib/api";

const API_URL = import.meta.env.VITE_API_URL || "/api";

export type TerrainPhoto = {
  id: number;
  terrain_id: number;
  url: string;
  nom_fichier?: string | null;
  taille_octets?: number | null;
  est_principale?: number | boolean;
  ordre?: number;
  uploaded_by?: number | null;
  uploaded_by_role?: string | null;
};

async function adminRequest(endpoint: string, options: RequestInit = {}) {
  const token = authApi.getToken() || localStorage.getItem("admin_token");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> || {}),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_URL}${endpoint}`, { cache: "no-store", ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Erreur serveur");
  return data;
}

async function adminFormData(endpoint: string, form: FormData) {
  const token = authApi.getToken() || localStorage.getItem("admin_token");
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_URL}${endpoint}`, { method: "POST", body: form, headers, cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Erreur serveur");
  return data;
}

/** Endpoints super_admin (routes /api/admin/*). */
export const superAdminApi = {
  login: (telephone: string, password: string) =>
    adminRequest("/admin/auth/login", { method: "POST", body: JSON.stringify({ telephone, password }) }),
  dashboard: () => adminRequest("/admin/dashboard"),
  profile: () => adminRequest("/admin/profile"),
  terrains: () => adminRequest("/admin/terrains"),
  createTerrain: (data: unknown) =>
    adminRequest("/admin/terrains", { method: "POST", body: JSON.stringify(data) }),
  updateLocalisation: (
    id: number,
    data: {
      adresse_theorique?: string | null;
      adresse_nominatim?: string | null;
      latitude?: number | null;
      longitude?: number | null;
    },
  ) => adminRequest(`/admin/terrains/${id}/localisation`, { method: "PATCH", body: JSON.stringify(data) }),
  terrainStatus: (id: number, statut: string) =>
    adminRequest(`/admin/terrains/${id}/statut`, { method: "PATCH", body: JSON.stringify({ statut }) }),
  terrainPhotos: (id: number): Promise<TerrainPhoto[]> => adminRequest(`/admin/terrains/${id}/photos`),
  uploadTerrainPhoto: (id: number, data: { dataUrl: string; est_principale?: boolean; ordre?: number }) =>
    adminRequest(`/admin/terrains/${id}/photos`, { method: "POST", body: JSON.stringify(data) }),
  uploadTerrainPhotoFile: (id: number, file: File, estPrincipale = false) => {
    const form = new FormData();
    form.append("photos", file);
    if (estPrincipale) form.append("est_principale", "true");
    return adminFormData(`/admin/terrains/${id}/photos`, form);
  },
  updateTerrainPhoto: (id: number, photoId: number, data: { est_principale?: boolean; ordre?: number }) =>
    adminRequest(`/admin/terrains/${id}/photos/${photoId}`, { method: "PATCH", body: JSON.stringify(data) }),
  setTerrainPhotoPrincipale: (id: number, photoId: number) =>
    adminRequest(`/admin/terrains/${id}/photos/${photoId}/principale`, { method: "PATCH" }),
  reorderTerrainPhotos: (id: number, ordre: number[]) =>
    adminRequest(`/admin/terrains/${id}/photos/ordre`, { method: "PATCH", body: JSON.stringify({ ordre }) }),
  removeTerrainPhoto: (id: number, photoId: number) =>
    adminRequest(`/admin/terrains/${id}/photos/${photoId}`, { method: "DELETE" }),
  users: () => adminRequest("/admin/users"),
  createUser: (data: unknown) =>
    adminRequest("/admin/users", { method: "POST", body: JSON.stringify(data) }),
  revenus: (periode: string) => adminRequest(`/admin/revenus?periode=${periode}`),
  finances: () => adminRequest("/admin/finances"),
  abonnements: () => adminRequest("/admin/abonnements"),
  payerAbonnement: (id: number) =>
    adminRequest(`/admin/abonnements/${id}/payer`, { method: "POST" }),
  payerAchatDefinitif: (terrainId: number, montant?: number) =>
    adminRequest(`/admin/terrains/${terrainId}/achat-definitif/payer`, {
      method: "POST",
      body: JSON.stringify({ montant }),
    }),
  politiqueAnnulation: (terrainId: number, delai_remboursement_heures: number) =>
    adminRequest(`/admin/terrains/${terrainId}/politique-annulation`, {
      method: "PATCH",
      body: JSON.stringify({ delai_remboursement_heures }),
    }),
  delaiVerrouPaiement: (terrainId: number, delai_verrou_paiement_min: number) =>
    adminRequest(`/admin/terrains/${terrainId}/delai-verrou-paiement`, {
      method: "PATCH",
      body: JSON.stringify({ delai_verrou_paiement_min }),
    }),
  updateTarifs: (terrainId: number, data: unknown) =>
    adminRequest(`/admin/terrains/${terrainId}/tarifs`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  reglesTarifs: (terrainId: number) => adminRequest(`/admin/terrains/${terrainId}/regles-tarifs`),
  createRegleTarif: (terrainId: number, data: unknown) =>
    adminRequest(`/admin/terrains/${terrainId}/regles-tarifs`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateRegleTarif: (terrainId: number, regleId: number, data: unknown) =>
    adminRequest(`/admin/terrains/${terrainId}/regles-tarifs/${regleId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  toggleRegleTarif: (terrainId: number, regleId: number, actif: boolean) =>
    adminRequest(`/admin/terrains/${terrainId}/regles-tarifs/${regleId}`, {
      method: "PATCH",
      body: JSON.stringify({ actif }),
    }),
  deleteRegleTarif: (terrainId: number, regleId: number) =>
    adminRequest(`/admin/terrains/${terrainId}/regles-tarifs/${regleId}`, { method: "DELETE" }),
  saveGrilleTarifs: (terrainId: number, data: unknown) =>
    adminRequest(`/admin/terrains/${terrainId}/grille-tarifs`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  validerPropositionTarif: (id: number) =>
    adminRequest(`/admin/propositions-tarifs/${id}/valider`, { method: "POST" }),
  refuserPropositionTarif: (id: number, commentaire?: string) =>
    adminRequest(`/admin/propositions-tarifs/${id}/refuser`, {
      method: "POST",
      body: JSON.stringify({ commentaire }),
    }),
  dettes: (params?: { periode?: string; terrain_id?: number; statut?: string }) => {
    const sp = new URLSearchParams();
    if (params?.periode) sp.set("periode", params.periode);
    if (params?.terrain_id) sp.set("terrain_id", String(params.terrain_id));
    if (params?.statut) sp.set("statut", params.statut);
    const q = sp.toString();
    return adminRequest(`/admin/dettes${q ? `?${q}` : ""}`);
  },
  remiseAZeroDette: (terrainId: number, data: { note?: string; montant_recu?: number; periode?: string }) =>
    adminRequest(`/admin/dettes/${terrainId}/remise-a-zero`, { method: "PATCH", body: JSON.stringify(data) }),
  saveDetteInstructions: (texte: string) =>
    adminRequest("/admin/dettes/instructions", { method: "PATCH", body: JSON.stringify({ texte }) }),
  commodites: () => adminRequest("/admin/commodites"),
  createCommodite: (data: unknown) =>
    adminRequest("/admin/commodites", { method: "POST", body: JSON.stringify(data) }),
  updateCommodite: (id: number, data: unknown) =>
    adminRequest(`/admin/commodites/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteCommodite: (id: number) =>
    adminRequest(`/admin/commodites/${id}`, { method: "DELETE" }),
  terrainCommodites: (id: number) => adminRequest(`/admin/terrains/${id}/commodites`),
  saveTerrainCommodites: (id: number, commodite_ids: number[]) =>
    adminRequest(`/admin/terrains/${id}/commodites`, { method: "PUT", body: JSON.stringify({ commodite_ids }) }),
  terrainAudit: (id: number) => adminRequest(`/admin/terrains/${id}/audit`),
  auditGlobal: (params?: Record<string, string | number | undefined>) => {
    const sp = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v != null && v !== "") sp.set(k, String(v));
    });
    const q = sp.toString();
    return adminRequest(`/admin/audit/photos-commodites${q ? `?${q}` : ""}`);
  },
  terrainEssai: (id: number) => adminRequest(`/admin/terrains/${id}/essai`),
  patchTerrainEssai: (id: number, body: Record<string, unknown>) =>
    adminRequest(`/admin/terrains/${id}/essai`, { method: "PATCH", body: JSON.stringify(body) }),
  essaiKpis: () => adminRequest("/admin/essai-kpis"),
  terrainFeatures: (id: number) => adminRequest(`/admin/terrains/${id}/features`),
  saveTerrainFeatures: (id: number, features: { cle: string; actif: boolean }[]) =>
    adminRequest(`/admin/terrains/${id}/features`, { method: "PUT", body: JSON.stringify({ features }) }),
  whatsappStatus: () => adminRequest("/admin/whatsapp/status"),
  whatsappQr: () => adminRequest("/admin/whatsapp/qr"),
  whatsappConnect: (force = false) =>
    adminRequest("/admin/whatsapp/connect", { method: "POST", body: JSON.stringify({ force }) }),
  whatsappDisconnect: () => adminRequest("/admin/whatsapp/disconnect", { method: "POST" }),
  whatsappTest: (telephone: string) =>
    adminRequest("/admin/whatsapp/test", { method: "POST", body: JSON.stringify({ telephone }) }),
  bugAlertsStatus: () => adminRequest("/admin/bug-alerts/status"),
  bugAlertsTest: (message?: string) =>
    adminRequest("/admin/bug-alerts/test", {
      method: "POST",
      body: JSON.stringify({ message: message || "Test manuel alerte développeur" }),
    }),
  modeRevenuDefaults: () => adminRequest("/admin/mode-revenu/defaults"),
  saveModeRevenuDefaults: (body: Record<string, unknown>) =>
    adminRequest("/admin/mode-revenu/defaults", { method: "PATCH", body: JSON.stringify(body) }),
  modeRevenuHistory: () => adminRequest("/admin/mode-revenu/history"),
  patchTerrainModeRevenu: (id: number, body: Record<string, unknown>) =>
    adminRequest(`/admin/terrains/${id}/mode-revenu`, { method: "PATCH", body: JSON.stringify(body) }),

  // Multi-gérants
  terrainGerants: (id: number) => adminRequest(`/admin/terrains/${id}/gerants`),
  terrainGardeActuelle: (id: number) => adminRequest(`/admin/terrains/${id}/gerants/garde-actuelle`),
  searchGerants: (q = "") => adminRequest(`/admin/gerants/search?q=${encodeURIComponent(q)}`),
  addTerrainGerant: (
    id: number,
    body: {
      gerant_id: number;
      est_principal?: number | boolean;
      note?: string | null;
      date_debut?: string | null;
      date_fin?: string | null;
    },
  ) => adminRequest(`/admin/terrains/${id}/gerants`, { method: "POST", body: JSON.stringify(body) }),
  patchTerrainGerant: (id: number, gerantId: number, body: Record<string, unknown>) =>
    adminRequest(`/admin/terrains/${id}/gerants/${gerantId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  removeTerrainGerant: (id: number, gerantId: number) =>
    adminRequest(`/admin/terrains/${id}/gerants/${gerantId}`, { method: "DELETE" }),
  setGerantPrincipal: (id: number, gerantId: number) =>
    adminRequest(`/admin/terrains/${id}/gerants/${gerantId}/principal`, { method: "POST" }),
  saveGerantPlanning: (
    id: number,
    gerantId: number,
    body: {
      planning_hebdo: Array<{
        jour_semaine: number;
        heure_debut?: string | null;
        heure_fin?: string | null;
        actif?: boolean;
      }>;
      dates_specifiques: Array<{
        date_specifique: string;
        heure_debut?: string | null;
        heure_fin?: string | null;
      }>;
    },
  ) =>
    adminRequest(`/admin/terrains/${id}/gerants/${gerantId}/planning`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),

  // Propriétaires / Superadmins
  proprietaires: () => adminRequest("/admin/proprietaires"),
  createProprietaire: (body: {
    nom: string;
    prenom?: string;
    telephone: string;
    email?: string;
    terrain_id?: number | null;
  }) => adminRequest("/admin/proprietaires", { method: "POST", body: JSON.stringify(body) }),
  patchProprietaire: (id: number, body: Record<string, unknown>) =>
    adminRequest(`/admin/proprietaires/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  superadmins: () => adminRequest("/admin/superadmins"),
  createSuperadmin: (body: { nom: string; prenom?: string; telephone: string; email?: string }) =>
    adminRequest("/admin/superadmins", { method: "POST", body: JSON.stringify(body) }),
  patchSuperadmin: (id: number, body: Record<string, unknown>) =>
    adminRequest(`/admin/superadmins/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
};

export type TerrainGerant = {
  id?: number;
  gerant_id: number;
  terrain_id?: number;
  prenom?: string | null;
  nom?: string | null;
  telephone?: string | null;
  whatsapp_number?: string | null;
  email?: string | null;
  est_principal?: number | boolean;
  actif?: number | boolean;
  note?: string | null;
  date_debut?: string | null;
  date_fin?: string | null;
  nb_gardes?: number;
};
