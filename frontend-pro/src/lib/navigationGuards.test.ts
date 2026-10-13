/**
 * Documentation testée des gardes de navigation (logique pure).
 * Miroir conceptuel de RoleGuard / JoueurSpaceGuard / RequireJoueurAuth.
 */
import { describe, expect, it } from "vitest";
import { homeForUser, normalizeRole, profileForUser, ROLE_HOME, type AppRole } from "@/auth/roles";
import { ROUTE_MAP } from "@/router/routesParRole";

const STAFF_ROLES: AppRole[] = ["gerant", "proprietaire", "super_admin"];
const JOUEUR_SPACE_PREFIXES = ["/", "/explorer", "/terrain/", "/paiement/", "/reservations", "/reservation/"];

/** Résolution attendue : staff sur espace joueur → home rôle. */
function resolveStaffOnJoueurSpace(user: { role?: string }): string {
  const role = normalizeRole(user);
  if (role && role !== "joueur") return homeForUser(user);
  return ROLE_HOME.joueur;
}

/** Chemins « autorisés » conceptuels pour un rôle (home + routes ROUTE_MAP). */
function allowedPathsFor(role: AppRole): string[] {
  return [ROUTE_MAP[role].home, ...ROUTE_MAP[role].routes];
}

describe("navigationGuards — homes documentés", () => {
  it("chaque rôle a un ROLE_HOME unique et cohérent avec ROUTE_MAP", () => {
    expect(ROLE_HOME.joueur).toBe("/");
    expect(ROLE_HOME.gerant).toBe("/backoffice/gerant");
    expect(ROLE_HOME.proprietaire).toBe("/backoffice/proprietaire");
    expect(ROLE_HOME.super_admin).toBe("/backoffice/superadmin");

    const homes = Object.values(ROLE_HOME);
    expect(new Set(homes).size).toBe(homes.length);

    for (const role of Object.keys(ROLE_HOME) as AppRole[]) {
      expect(allowedPathsFor(role)).toContain(ROLE_HOME[role]);
      expect(homeForUser({ role })).toBe(ROLE_HOME[role]);
    }
  });

  it("profils alignés sur le rôle (pas de cross-profil)", () => {
    expect(profileForUser({ role: "joueur" })).toBe("/profil/joueur");
    expect(profileForUser({ role: "gerant" })).toBe("/profil/gerant");
    expect(profileForUser({ role: "proprietaire" })).toBe("/profil/proprietaire");
    expect(profileForUser({ role: "super_admin" })).toBe("/profil/admin");
  });
});

describe("navigationGuards — staff hors espace joueur", () => {
  it("redirige staff loin de l'accueil joueur vers leur backoffice", () => {
    for (const role of STAFF_ROLES) {
      expect(resolveStaffOnJoueurSpace({ role })).toBe(ROLE_HOME[role]);
      expect(resolveStaffOnJoueurSpace({ role })).not.toBe("/");
      expect(resolveStaffOnJoueurSpace({ role })).not.toBe("/joueur");
    }
  });

  it("laisse le joueur sur / (et jamais /joueur)", () => {
    expect(resolveStaffOnJoueurSpace({ role: "joueur" })).toBe("/");
    expect(resolveStaffOnJoueurSpace({ role: "user" })).toBe("/");
  });

  it("les homes staff ne sont pas des préfixes d'espace joueur réservé", () => {
    for (const role of STAFF_ROLES) {
      const home = ROLE_HOME[role];
      expect(home.startsWith("/backoffice/")).toBe(true);
      for (const prefix of JOUEUR_SPACE_PREFIXES) {
        if (prefix === "/") continue;
        expect(home.startsWith(prefix)).toBe(false);
      }
    }
  });

  it("alias employe / superadmin suivent les mêmes homes staff", () => {
    expect(homeForUser({ role: "employe" })).toBe(ROLE_HOME.gerant);
    expect(homeForUser({ role: "superadmin" })).toBe(ROLE_HOME.super_admin);
    expect(resolveStaffOnJoueurSpace({ role: "employe" })).toBe("/backoffice/gerant");
    expect(resolveStaffOnJoueurSpace({ role: "superadmin" })).toBe("/backoffice/superadmin");
  });
});

describe("navigationGuards — chemins autorisés vs ROLE_HOME", () => {
  it("le premier chemin autorisé de chaque rôle est sa home", () => {
    for (const role of Object.keys(ROLE_HOME) as AppRole[]) {
      const allowed = allowedPathsFor(role);
      expect(allowed[0]).toBe(ROLE_HOME[role]);
    }
  });

  it("aucun chemin autorisé staff ne cible /joueur", () => {
    for (const role of STAFF_ROLES) {
      for (const path of allowedPathsFor(role)) {
        expect(path).not.toBe("/joueur");
        expect(path.startsWith("/joueur")).toBe(false);
      }
    }
  });
});
