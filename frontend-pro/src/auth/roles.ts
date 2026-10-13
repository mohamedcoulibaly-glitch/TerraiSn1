export type AppRole = "joueur" | "gerant" | "proprietaire" | "super_admin";

export const ROLE_HOME: Record<AppRole, string> = {
  joueur: "/",
  gerant: "/backoffice/gerant",
  proprietaire: "/backoffice/proprietaire",
  super_admin: "/backoffice/superadmin",
};

/** Normalise le rôle API (accountType + role) vers le rôle applicatif. */
export function normalizeRole(user: { role?: string; accountType?: string } | null | undefined): AppRole | null {
  if (!user) return null;
  const role = (user.role || "").toLowerCase();
  const accountType = (user.accountType || "").toLowerCase();

  if (role === "super_admin" || role === "superadmin") return "super_admin";
  if (role === "proprietaire" || accountType === "proprietaire") return "proprietaire";
  if (role === "gerant" || role === "employe" || accountType === "employe") return "gerant";
  if (role === "joueur" || role === "user") return "joueur";
  // accountType user sans rôle métier explicite → joueur (pas super_admin, déjà géré)
  if (accountType === "user") return "joueur";
  return null;
}

export function homeForUser(user: { role?: string; accountType?: string } | null | undefined): string {
  const role = normalizeRole(user);
  return role ? ROLE_HOME[role] : "/login";
}

export function profileForUser(user: { role?: string; accountType?: string } | null | undefined): string {
  const role = normalizeRole(user);
  if (role === "gerant") return "/profil/gerant";
  if (role === "proprietaire") return "/profil/proprietaire";
  if (role === "super_admin") return "/profil/admin";
  return "/profil/joueur";
}
