import type { AppRole } from "@/auth/roles";
import { ROLE_HOME } from "@/auth/roles";

/**
 * Carte des routes applicatives par rôle (chemins canoniques).
 * Source de vérité pour les tests de navigation — alignée sur AppRouter.
 */
export const ROUTE_MAP = {
  joueur: {
    home: ROLE_HOME.joueur,
    routes: [
      "/",
      "/explorer",
      "/terrain/:id",
      "/paiement/:id",
      "/reservations",
      "/reservation/succes",
      "/profil/joueur",
      "/profil/notifications",
      "/profil/securite",
      "/profil/aide",
    ],
  },
  gerant: {
    home: ROLE_HOME.gerant,
    routes: [
      "/backoffice/gerant",
      "/backoffice/gerant/joueurs",
      "/backoffice/gerant/finances",
      "/backoffice/gerant/parametres",
      "/backoffice/gerant/reservations/:id",
      "/profil/gerant",
    ],
    /** Anciennes URLs → cibles de Navigate (AppRouter). */
    legacyRedirects: {
      "/gerant": "/backoffice/gerant",
      "/backoffice/gerant/flux": "/backoffice/gerant",
      "/backoffice/gerant/creneaux": "/backoffice/gerant/parametres",
      "/backoffice/gerant/tarifs": "/backoffice/gerant/parametres",
      "/backoffice/gerant/reservations": "/backoffice/gerant/joueurs",
      "/backoffice/gerant/portefeuille": "/backoffice/gerant/finances",
      "/backoffice/gerant/scanner": "/backoffice/gerant",
      "/gerant/calendrier": "/backoffice/gerant/creneaux",
    } as Record<string, string>,
  },
  proprietaire: {
    home: ROLE_HOME.proprietaire,
    routes: [
      "/backoffice/proprietaire",
      "/backoffice/proprietaire/revenus",
      "/backoffice/proprietaire/sante",
      "/backoffice/proprietaire/terrains",
      "/backoffice/proprietaire/terrain/:id",
      "/profil/proprietaire",
    ],
    legacyRedirects: {
      "/proprietaire": "/backoffice/proprietaire",
      "/proprietaire/rapports": "/backoffice/proprietaire/revenus",
    } as Record<string, string>,
  },
  super_admin: {
    home: ROLE_HOME.super_admin,
    routes: [
      "/backoffice/superadmin",
      "/backoffice/superadmin/terrains",
      "/backoffice/superadmin/gerants",
      "/backoffice/superadmin/proprietaires",
      "/backoffice/superadmin/superadmins",
      "/backoffice/superadmin/utilisateurs",
      "/backoffice/superadmin/caisse",
      "/backoffice/superadmin/audit",
      "/backoffice/superadmin/rapprochement",
      "/backoffice/superadmin/revenus",
      "/backoffice/superadmin/abonnements",
      "/backoffice/superadmin/commodites",
      "/backoffice/superadmin/whatsapp",
      "/profil/admin",
    ],
    legacyRedirects: {
      "/admin": "/backoffice/superadmin",
      "/backoffice/admin": "/backoffice/superadmin",
      "/backoffice/admin/terrains": "/backoffice/superadmin/terrains",
      "/backoffice/admin/utilisateurs": "/backoffice/superadmin/utilisateurs",
      "/backoffice/admin/revenus": "/backoffice/superadmin/revenus",
      "/backoffice/admin/abonnements": "/backoffice/superadmin/abonnements",
      "/backoffice/admin/caisse": "/backoffice/superadmin/caisse",
      "/backoffice/admin/rapprochement": "/backoffice/superadmin/rapprochement",
    } as Record<string, string>,
  },
} as const satisfies Record<
  AppRole,
  {
    home: string;
    routes: readonly string[];
    legacyRedirects?: Record<string, string>;
  }
>;

export type RouteMapRole = keyof typeof ROUTE_MAP;

/** Toutes les routes plates (tous rôles), pour assertions globales. */
export function allRoutesFlat(): string[] {
  return (Object.keys(ROUTE_MAP) as AppRole[]).flatMap((role) => [...ROUTE_MAP[role].routes]);
}
