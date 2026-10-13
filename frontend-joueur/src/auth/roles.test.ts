import { describe, expect, it } from "vitest";
import {
  normalizeRole,
  homeForUser,
  profileForUser,
  isNonJoueur,
  ROLE_HOME,
  MESSAGE_COMPTE_PRO,
} from "@/auth/roles";

describe("roles — normalisation & redirections (app joueur)", () => {
  it("normalise joueur / user", () => {
    expect(normalizeRole({ role: "joueur" })).toBe("joueur");
    expect(normalizeRole({ role: "user" })).toBe("joueur");
    expect(normalizeRole({ role: "User" })).toBe("joueur");
    expect(normalizeRole({ accountType: "user" })).toBe("joueur");
    expect(normalizeRole({ accountType: "USER" })).toBe("joueur");
    expect(normalizeRole({ role: "joueur", accountType: "user" })).toBe("joueur");
  });

  it("détecte gerant / employe (pour les rejeter)", () => {
    expect(normalizeRole({ role: "gerant" })).toBe("gerant");
    expect(normalizeRole({ role: "employe" })).toBe("gerant");
    expect(normalizeRole({ role: "Employe" })).toBe("gerant");
    expect(normalizeRole({ accountType: "employe" })).toBe("gerant");
  });

  it("détecte proprietaire", () => {
    expect(normalizeRole({ role: "proprietaire" })).toBe("proprietaire");
    expect(normalizeRole({ accountType: "proprietaire" })).toBe("proprietaire");
  });

  it("détecte super_admin / superadmin", () => {
    expect(normalizeRole({ role: "super_admin" })).toBe("super_admin");
    expect(normalizeRole({ role: "superadmin" })).toBe("super_admin");
    expect(normalizeRole({ role: "super_admin", accountType: "user" })).toBe("super_admin");
  });

  it("retourne null si inconnu / vide", () => {
    expect(normalizeRole(null)).toBeNull();
    expect(normalizeRole(undefined)).toBeNull();
    expect(normalizeRole({})).toBeNull();
    expect(normalizeRole({ role: "hackeur" })).toBeNull();
    expect(normalizeRole({ accountType: "admin" })).toBeNull();
  });

  it("isNonJoueur rejette les comptes pro uniquement", () => {
    expect(isNonJoueur({ role: "joueur" })).toBe(false);
    expect(isNonJoueur({ role: "user" })).toBe(false);
    expect(isNonJoueur(null)).toBe(false);
    expect(isNonJoueur({ role: "gerant" })).toBe(true);
    expect(isNonJoueur({ role: "proprietaire" })).toBe(true);
    expect(isNonJoueur({ role: "super_admin" })).toBe(true);
  });

  it("ROLE_HOME ne contient que joueur", () => {
    expect(ROLE_HOME.joueur).toBe("/");
    expect(ROLE_HOME.gerant).toBeUndefined();
    expect(MESSAGE_COMPTE_PRO).toContain("pro.terrainsn.com");
  });

  it("homeForUser : / pour joueur, /login sinon", () => {
    expect(homeForUser({ role: "joueur" })).toBe("/");
    expect(homeForUser({ role: "user" })).toBe("/");
    expect(homeForUser({ role: "gerant" })).toBe("/login");
    expect(homeForUser(null)).toBe("/login");
    expect(homeForUser({})).toBe("/login");
  });

  it("profileForUser renvoie toujours /profil/joueur", () => {
    expect(profileForUser({ role: "joueur" })).toBe("/profil/joueur");
    expect(profileForUser(null)).toBe("/profil/joueur");
    expect(profileForUser(undefined)).toBe("/profil/joueur");
  });
});
