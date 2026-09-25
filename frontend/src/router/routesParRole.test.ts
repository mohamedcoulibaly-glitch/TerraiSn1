import { describe, expect, it } from "vitest";
import { ROLE_HOME, type AppRole } from "@/auth/roles";
import { ROUTE_MAP, allRoutesFlat } from "@/router/routesParRole";

const ALL_ROLES: AppRole[] = ["joueur", "gerant", "proprietaire", "super_admin"];

describe("ROUTE_MAP — complétude par rôle", () => {
  it("exporte une entrée pour chaque AppRole", () => {
    expect(Object.keys(ROUTE_MAP).sort()).toEqual([...ALL_ROLES].sort());
  });

  it("aligne home sur ROLE_HOME", () => {
    for (const role of ALL_ROLES) {
      expect(ROUTE_MAP[role].home).toBe(ROLE_HOME[role]);
      expect(ROUTE_MAP[role].routes).toContain(ROUTE_MAP[role].home);
    }
  });

  it("joueur : parcours public + réservation + profil", () => {
    expect(ROUTE_MAP.joueur.routes).toEqual([
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
    ]);
  });

  it("gerant : backoffice + legacy redirects", () => {
    expect(ROUTE_MAP.gerant.routes).toEqual([
      "/backoffice/gerant",
      "/backoffice/gerant/joueurs",
      "/backoffice/gerant/finances",
      "/backoffice/gerant/parametres",
      "/backoffice/gerant/reservations/:id",
      "/profil/gerant",
    ]);
    expect(ROUTE_MAP.gerant.legacyRedirects["/gerant"]).toBe("/backoffice/gerant");
    expect(ROUTE_MAP.gerant.legacyRedirects["/backoffice/gerant/flux"]).toBe("/backoffice/gerant");
    expect(ROUTE_MAP.gerant.legacyRedirects["/backoffice/gerant/creneaux"]).toBe(
      "/backoffice/gerant/parametres",
    );
    expect(ROUTE_MAP.gerant.legacyRedirects["/backoffice/gerant/tarifs"]).toBe(
      "/backoffice/gerant/parametres",
    );
    expect(ROUTE_MAP.gerant.legacyRedirects["/backoffice/gerant/reservations"]).toBe(
      "/backoffice/gerant/joueurs",
    );
    expect(ROUTE_MAP.gerant.legacyRedirects["/backoffice/gerant/portefeuille"]).toBe(
      "/backoffice/gerant/finances",
    );
    expect(ROUTE_MAP.gerant.legacyRedirects["/backoffice/gerant/scanner"]).toBe(
      "/backoffice/gerant",
    );
  });

  it("proprietaire : revenus / santé / terrains", () => {
    expect(ROUTE_MAP.proprietaire.routes).toEqual([
      "/backoffice/proprietaire",
      "/backoffice/proprietaire/revenus",
      "/backoffice/proprietaire/sante",
      "/backoffice/proprietaire/terrains",
      "/backoffice/proprietaire/terrain/:id",
      "/profil/proprietaire",
    ]);
    expect(ROUTE_MAP.proprietaire.legacyRedirects["/proprietaire"]).toBe(
      "/backoffice/proprietaire",
    );
    expect(ROUTE_MAP.proprietaire.legacyRedirects["/proprietaire/rapports"]).toBe(
      "/backoffice/proprietaire/revenus",
    );
  });

  it("super_admin : module complet plateforme", () => {
    expect(ROUTE_MAP.super_admin.routes).toEqual([
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
    ]);
    expect(ROUTE_MAP.super_admin.legacyRedirects["/admin"]).toBe("/backoffice/superadmin");
    expect(ROUTE_MAP.super_admin.legacyRedirects["/backoffice/admin"]).toBe(
      "/backoffice/superadmin",
    );
  });
});

describe("ROUTE_MAP — garde-fou /joueur cassé", () => {
  it("aucune route ni home ne pointe vers /joueur (accueil = /)", () => {
    expect(ROLE_HOME.joueur).toBe("/");
    expect(ROUTE_MAP.joueur.home).toBe("/");

    const all = allRoutesFlat();
    for (const path of all) {
      expect(path).not.toBe("/joueur");
      expect(path.startsWith("/joueur/")).toBe(false);
    }

    for (const role of ALL_ROLES) {
      expect(ROUTE_MAP[role].home).not.toBe("/joueur");
      const redirects = "legacyRedirects" in ROUTE_MAP[role] ? ROUTE_MAP[role].legacyRedirects : {};
      for (const target of Object.values(redirects ?? {})) {
        expect(target).not.toBe("/joueur");
        expect(target.startsWith("/joueur/")).toBe(false);
      }
    }
  });

  it("chaque rôle a au moins une route et un home non vide", () => {
    for (const role of ALL_ROLES) {
      expect(ROUTE_MAP[role].routes.length).toBeGreaterThan(0);
      expect(ROUTE_MAP[role].home.length).toBeGreaterThan(0);
    }
  });
});
