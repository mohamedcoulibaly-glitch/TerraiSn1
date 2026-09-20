import { describe, expect, it } from "vitest";
import { normalizeRole, homeForUser, profileForUser, ROLE_HOME } from "@/auth/roles";

describe("roles — normalisation & redirections", () => {
  it("normalise joueur / user", () => {
    expect(normalizeRole({ role: "joueur" })).toBe("joueur");
    expect(normalizeRole({ role: "user" })).toBe("joueur");
    expect(normalizeRole({ accountType: "user" })).toBe("joueur");
  });

  it("normalise gerant / employe", () => {
    expect(normalizeRole({ role: "gerant" })).toBe("gerant");
    expect(normalizeRole({ role: "employe" })).toBe("gerant");
    expect(normalizeRole({ accountType: "employe" })).toBe("gerant");
  });

  it("normalise proprietaire", () => {
    expect(normalizeRole({ role: "proprietaire" })).toBe("proprietaire");
    expect(normalizeRole({ accountType: "proprietaire" })).toBe("proprietaire");
  });

  it("normalise super_admin / superadmin", () => {
    expect(normalizeRole({ role: "super_admin" })).toBe("super_admin");
    expect(normalizeRole({ role: "superadmin" })).toBe("super_admin");
  });

  it("retourne null si inconnu", () => {
    expect(normalizeRole(null)).toBeNull();
    expect(normalizeRole({})).toBeNull();
    expect(normalizeRole({ role: "hackeur" })).toBeNull();
  });

  it("homeForUser pointe vers le bon espace", () => {
    expect(homeForUser({ role: "joueur" })).toBe(ROLE_HOME.joueur);
    expect(homeForUser({ role: "gerant" })).toBe("/backoffice/gerant");
    expect(homeForUser({ role: "proprietaire" })).toBe("/backoffice/proprietaire");
    expect(homeForUser({ role: "super_admin" })).toBe("/backoffice/superadmin");
    expect(homeForUser(null)).toBe("/login");
  });

  it("profileForUser pointe vers le bon profil", () => {
    expect(profileForUser({ role: "joueur" })).toBe("/profil/joueur");
    expect(profileForUser({ role: "gerant" })).toBe("/profil/gerant");
    expect(profileForUser({ role: "proprietaire" })).toBe("/profil/proprietaire");
    expect(profileForUser({ role: "super_admin" })).toBe("/profil/admin");
  });
});
