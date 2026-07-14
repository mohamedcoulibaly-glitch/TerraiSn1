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

/** Endpoints super_admin (routes /api/admin/*) — lecture seule côté front, pas de changement backend. */
export const superAdminApi = {
  login: (telephone: string, password: string) =>
    adminRequest("/admin/auth/login", { method: "POST", body: JSON.stringify({ telephone, password }) }),
  dashboard: () => adminRequest("/admin/dashboard"),
  terrains: () => adminRequest("/admin/terrains"),
  createTerrain: (data: unknown) =>
    adminRequest("/admin/terrains", { method: "POST", body: JSON.stringify(data) }),
  terrainStatus: (id: number, statut: string) =>
    adminRequest(`/admin/terrains/${id}/statut`, { method: "PATCH", body: JSON.stringify({ statut }) }),
  users: () => adminRequest("/admin/users"),
  createUser: (data: unknown) =>
    adminRequest("/admin/users", { method: "POST", body: JSON.stringify(data) }),
  revenus: (periode: string) => adminRequest(`/admin/revenus?periode=${periode}`),
};
