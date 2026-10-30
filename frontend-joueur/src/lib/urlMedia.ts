/**
 * Résout une URL média (ex. `/uploads/qr/...`) contre l’origine API.
 * En prod same-origin (`VITE_API_URL=/api`), `/uploads` reste relatif au host.
 * En dév cross-host, on préfixe l’origine dérivée de `VITE_API_URL`.
 */
export function urlMedia(path: string | null | undefined): string {
  const raw = String(path || "").trim();
  if (!raw) return "";
  if (/^(https?:|data:|blob:)/i.test(raw)) return raw;

  const normalized = raw.startsWith("/") ? raw : `/${raw}`;
  if (!normalized.startsWith("/uploads")) return normalized;

  const apiUrl = String(import.meta.env.VITE_API_URL || "/api").trim() || "/api";

  // Same-origin relatif (`/api`) → le navigateur résout `/uploads` sur le host app.
  if (apiUrl.startsWith("/")) return normalized;

  try {
    const origin = new URL(apiUrl, typeof window !== "undefined" ? window.location.origin : "http://localhost").origin;
    return `${origin}${normalized}`;
  } catch {
    return normalized;
  }
}

export default urlMedia;
