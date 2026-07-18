import { authApi } from "@/lib/api";

const API_URL = import.meta.env.VITE_API_URL || "/api";

async function adminRequest(endpoint: string, options: RequestInit = {}) {
  const token = authApi.getToken() || localStorage.getItem("admin_token");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> || {}),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_URL}${endpoint}`, { ...options, headers });
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
  terrainStatus: (id: number, statut: string) =>
    adminRequest(`/admin/terrains/${id}/statut`, { method: "PATCH", body: JSON.stringify({ statut }) }),
  terrainPhotos: (id: number) => adminRequest(`/admin/terrains/${id}/photos`),
  uploadTerrainPhoto: (id: number, data: { dataUrl: string; est_principale?: boolean; ordre?: number }) =>
    adminRequest(`/admin/terrains/${id}/photos`, { method: "POST", body: JSON.stringify(data) }),
  updateTerrainPhoto: (id: number, photoId: number, data: { est_principale?: boolean; ordre?: number }) =>
    adminRequest(`/admin/terrains/${id}/photos/${photoId}`, { method: "PATCH", body: JSON.stringify(data) }),
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
};
