const API = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
export const token = () => localStorage.getItem('admin_token');
export async function request(path: string, options: RequestInit = {}) {
  const response = await fetch(`${API}${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...(token() ? { Authorization: `Bearer ${token()}` } : {}), ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Erreur serveur');
  return data;
}
export const adminApi = {
  login: (telephone: string, password: string) => request('/admin/auth/login', { method: 'POST', body: JSON.stringify({ telephone, password }) }),
  dashboard: () => request('/admin/dashboard'),
  terrains: () => request('/admin/terrains'),
  createTerrain: (data: any) => request('/admin/terrains', { method: 'POST', body: JSON.stringify(data) }),
  terrainStatus: (id: number, statut: string) => request(`/admin/terrains/${id}/statut`, { method: 'PATCH', body: JSON.stringify({ statut }) }),
  users: () => request('/admin/users'),
  createUser: (data: any) => request('/admin/users', { method: 'POST', body: JSON.stringify(data) }),
  revenus: (periode: string) => request(`/admin/revenus?periode=${periode}`),
};
