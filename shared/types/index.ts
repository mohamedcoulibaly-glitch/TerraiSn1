/** Types applicatifs partagés entre frontend-joueur et frontend-pro */

export type AppRole = "joueur" | "gerant" | "proprietaire" | "super_admin";

export const ROLES_PRO: AppRole[] = ["gerant", "proprietaire", "super_admin"];

export interface AuthUser {
  id: number;
  nom: string;
  prenom?: string;
  email?: string;
  telephone?: string;
  role: string;
  accountType?: string;
  [key: string]: unknown;
}
