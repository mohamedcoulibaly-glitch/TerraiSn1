export type AppRole = "joueur" | "gerant" | "proprietaire" | "super_admin";

/**
 * App joueur uniquement : seul le rôle joueur a un espace ici.
 * Les comptes professionnels (gérant / propriétaire / admin) se connectent sur pro.terrainsn.com.
 */
export const ROLE_HOME: Partial<Record<AppRole, string>> = {
  joueur: "/",
};

/** Message affiché quand un compte non-joueur tente de se connecter sur l'app joueur. */
export const MESSAGE_COMPTE_PRO =
  "Ce compte est un compte professionnel. Connecte-toi sur pro.terrainsn.com";

/**
 * Normalise le rôle API (accountType + role) vers le rôle applicatif.
 * Fonctionne pour TOUS les rôles : permet de détecter (et rejeter) les comptes non-joueur.
 */
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

/** Vrai si le compte n'est pas un joueur (rôle reconnu ET différent de joueur). */
export function isNonJoueur(user: { role?: string; accountType?: string } | null | undefined): boolean {
  const role = normalizeRole(user);
  return !!role && role !== "joueur";
}

export function homeForUser(user: { role?: string; accountType?: string } | null | undefined): string {
  const role = normalizeRole(user);
  return (role && ROLE_HOME[role]) || "/login";
}

export function profileForUser(_user?: { role?: string; accountType?: string } | null): string {
  return "/profil/joueur";
}
