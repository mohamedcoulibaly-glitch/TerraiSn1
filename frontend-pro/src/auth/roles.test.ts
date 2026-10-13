import { describe, expect, it } from "vitest";
import {
  normalizeRole,
  homeForUser,
  profileForUser,
  ROLE_HOME,
  type AppRole,
} from "@/auth/roles";

const ALL_ROLES: AppRole[] = ["joueur", "gerant", "proprietaire", "super_admin"];

describe("roles — normalisation & redirections", () => {
  it("normalise joueur / user", () => {
    expect(normalizeRole({ role: "joueur" })).toBe("joueur");
    expect(normalizeRole({ role: "user" })).toBe("joueur");
    expect(normalizeRole({ role: "User" })).toBe("joueur");
    expect(normalizeRole({ accountType: "user" })).toBe("joueur");
    expect(normalizeRole({ accountType: "USER" })).toBe("joueur");
    expect(normalizeRole({ role: "joueur", accountType: "user" })).toBe("joueur");
  });

  it("normalise gerant / employe", () => {
    expect(normalizeRole({ role: "gerant" })).toBe("gerant");
    expect(normalizeRole({ role: "employe" })).toBe("gerant");
    expect(normalizeRole({ role: "Employe" })).toBe("gerant");
    expect(normalizeRole({ accountType: "employe" })).toBe("gerant");
    expect(normalizeRole({ role: "gerant", accountType: "employe" })).toBe("gerant");
  });

  it("normalise proprietaire", () => {
    expect(normalizeRole({ role: "proprietaire" })).toBe("proprietaire");
    expect(normalizeRole({ role: "Proprietaire" })).toBe("proprietaire");
    expect(normalizeRole({ accountType: "proprietaire" })).toBe("proprietaire");
  });

  it("normalise super_admin / superadmin", () => {
    expect(normalizeRole({ role: "super_admin" })).toBe("super_admin");
    expect(normalizeRole({ role: "superadmin" })).toBe("super_admin");
    expect(normalizeRole({ role: "SuperAdmin" })).toBe("super_admin");
    expect(normalizeRole({ role: "SUPER_ADMIN" })).toBe("super_admin");
  });

  it("priorise super_admin même avec accountType user", () => {
    expect(normalizeRole({ role: "super_admin", accountType: "user" })).toBe("super_admin");
    expect(normalizeRole({ role: "superadmin", accountType: "user" })).toBe("super_admin");
  });

  it("retourne null si inconnu / vide", () => {
    expect(normalizeRole(null)).toBeNull();
    expect(normalizeRole(undefined)).toBeNull();
    expect(normalizeRole({})).toBeNull();
    expect(normalizeRole({ role: "" })).toBeNull();
    expect(normalizeRole({ role: "hackeur" })).toBeNull();
    expect(normalizeRole({ accountType: "admin" })).toBeNull();
    expect(normalizeRole({ role: "   " })).toBeNull();
  });

  it("ROLE_HOME couvre tous les AppRole et n'utilise pas /joueur", () => {
    for (const role of ALL_ROLES) {
      expect(ROLE_HOME[role]).toBeTruthy();
      expect(ROLE_HOME[role]).not.toMatch(/\/joueur$/);
      expect(ROLE_HOME[role]).not.toContain("/joueur");
    }
    expect(ROLE_HOME.joueur).toBe("/");
  });

  it("homeForUser pointe vers le bon espace pour chaque rôle", () => {
    expect(homeForUser({ role: "joueur" })).toBe(ROLE_HOME.joueur);
    expect(homeForUser({ role: "user" })).toBe("/");
    expect(homeForUser({ role: "gerant" })).toBe("/backoffice/gerant");
    expect(homeForUser({ role: "employe" })).toBe("/backoffice/gerant");
    expect(homeForUser({ role: "proprietaire" })).toBe("/backoffice/proprietaire");
    expect(homeForUser({ role: "super_admin" })).toBe("/backoffice/superadmin");
    expect(homeForUser({ role: "superadmin" })).toBe("/backoffice/superadmin");
  });

  it("homeForUser → /login pour null / undefined / inconnu", () => {
    expect(homeForUser(null)).toBe("/login");
    expect(homeForUser(undefined)).toBe("/login");
    expect(homeForUser({})).toBe("/login");
    expect(homeForUser({ role: "inconnu" })).toBe("/login");
  });

  it("profileForUser pointe vers le bon profil pour chaque rôle", () => {
    expect(profileForUser({ role: "joueur" })).toBe("/profil/joueur");
    expect(profileForUser({ role: "user" })).toBe("/profil/joueur");
    expect(profileForUser({ role: "gerant" })).toBe("/profil/gerant");
    expect(profileForUser({ role: "employe" })).toBe("/profil/gerant");
    expect(profileForUser({ role: "proprietaire" })).toBe("/profil/proprietaire");
    expect(profileForUser({ role: "super_admin" })).toBe("/profil/admin");
    expect(profileForUser({ role: "superadmin" })).toBe("/profil/admin");
  });

  it("profileForUser fallback joueur pour null / inconnu", () => {
    expect(profileForUser(null)).toBe("/profil/joueur");
    expect(profileForUser(undefined)).toBe("/profil/joueur");
    expect(profileForUser({})).toBe("/profil/joueur");
  });
});
