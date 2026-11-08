/**
 * Contrats UI des parcours critiques — tous rôles.
 * Complète l’intégration HTTP backend (vraie API) par la cartographie front.
 */
import { describe, expect, it } from "vitest";
import { homeForUser, normalizeRole, profileForUser, ROLE_HOME } from "@/auth/roles";
import { ROUTE_MAP } from "@/router/routesParRole";
import {
  assertStageTransition,
  type KanbanCardInput,
} from "@/lib/kanbanRules";

function card(overrides: Partial<KanbanCardInput> = {}): KanbanCardInput {
  return {
    stage: "reserved",
    statut: "confirme",
    date: "2026-11-10",
    heure_debut: "18:00",
    heure_fin: "19:00",
    fenetre_retard: 30,
    checked_in_at: null,
    montant_restant: 35000,
    crm: { bloqueReservation: false },
    ...overrides,
  };
}

/** API métier attendue par le front (chemins canoniques). */
export const PARCOURS_API = {
  joueur: [
    "POST /api/auth/register",
    "POST /api/auth/verify-otp",
    "POST /api/auth/login",
    "GET /api/terrains",
    "GET /api/terrains/:id/devis",
    "GET /api/terrains/:id/creneaux",
    "POST /api/reservations",
    "POST /api/payments/simulate",
    "GET /api/reservations/mes",
    "GET /api/reservations/:id/qr.png",
    "PUT /api/reservations/:id/annuler",
    "POST /api/auth/delete-account",
  ],
  gerant: [
    "POST /api/backoffice/auth/login",
    "GET /api/gerant/terrains",
    "GET /api/gerant/portefeuille",
    "POST /api/gerant/reservations/checkin-by-code",
    "PATCH /api/gerant/reservations/:id/stage",
    "POST /api/reservations/gerant",
    "POST /api/gerant/portefeuille/retirer",
  ],
  proprietaire: [
    "POST /api/backoffice/auth/login",
    "GET /api/proprietaire/terrains",
    "GET /api/proprietaire/revenus",
    "GET /api/proprietaire/audit",
    "GET /api/employes",
  ],
  super_admin: [
    "POST /api/admin/auth/login",
    "GET /api/admin/terrains",
    "GET /api/admin/users",
    "GET /api/admin/caisse/dashboard",
    "GET /api/admin/caisse/retraits",
    "PATCH /api/admin/terrains/:id/statut",
    "POST /api/admin/caisse/retraits/:id/envoyer",
    "PATCH /api/admin/terrains/:id/mode-revenu",
  ],
} as const;

describe("Parcours critiques — homes & routes par rôle", () => {
  it("expose les 4 rôles avec homes distincts", () => {
    expect(normalizeRole({ role: "joueur" })).toBe("joueur");
    expect(normalizeRole({ role: "gerant" })).toBe("gerant");
    expect(normalizeRole({ role: "proprietaire" })).toBe("proprietaire");
    expect(normalizeRole({ role: "super_admin" })).toBe("super_admin");

    expect(homeForUser({ role: "joueur" })).toBe(ROLE_HOME.joueur);
    expect(homeForUser({ role: "gerant" })).toBe("/backoffice/gerant");
    expect(homeForUser({ role: "proprietaire" })).toBe("/backoffice/proprietaire");
    expect(homeForUser({ role: "super_admin" })).toBe("/backoffice/superadmin");

    expect(Object.keys(ROUTE_MAP)).toEqual(
      expect.arrayContaining(["joueur", "gerant", "proprietaire", "super_admin"]),
    );
  });

  it("couvre les écrans critiques joueur", () => {
    for (const path of ["/", "/explorer", "/terrain/:id", "/paiement/:id", "/reservations", "/reservation/succes"]) {
      expect(ROUTE_MAP.joueur.routes).toContain(path);
    }
    expect(profileForUser({ role: "joueur" })).toBe("/profil/joueur");
  });

  it("couvre finances + paramètres gérant", () => {
    expect(ROUTE_MAP.gerant.routes).toEqual(
      expect.arrayContaining([
        "/backoffice/gerant",
        "/backoffice/gerant/joueurs",
        "/backoffice/gerant/finances",
        "/backoffice/gerant/parametres",
      ]),
    );
  });

  it("couvre revenus + terrains propriétaire", () => {
    expect(ROUTE_MAP.proprietaire.routes).toEqual(
      expect.arrayContaining([
        "/backoffice/proprietaire",
        "/backoffice/proprietaire/revenus",
        "/backoffice/proprietaire/terrains",
        "/backoffice/proprietaire/sante",
      ]),
    );
  });

  it("couvre caisse + provisioning super admin", () => {
    expect(ROUTE_MAP.super_admin.routes).toEqual(
      expect.arrayContaining([
        "/backoffice/superadmin",
        "/backoffice/superadmin/terrains",
        "/backoffice/superadmin/caisse",
        "/backoffice/superadmin/proprietaires",
        "/backoffice/superadmin/gerants",
      ]),
    );
  });
});

describe("Parcours critiques — contrats API front", () => {
  it("documente les endpoints de chaque rôle", () => {
    expect(PARCOURS_API.joueur.length).toBeGreaterThanOrEqual(10);
    expect(PARCOURS_API.gerant).toContain("POST /api/gerant/reservations/checkin-by-code");
    expect(PARCOURS_API.gerant).toContain("POST /api/gerant/portefeuille/retirer");
    expect(PARCOURS_API.super_admin).toContain("POST /api/admin/caisse/retraits/:id/envoyer");
    expect(PARCOURS_API.proprietaire).not.toContain("POST /api/admin/caisse/retraits/:id/envoyer");
  });
});

describe("Parcours critiques — kanban gérant après check-in", () => {
  const inWindow = new Date("2026-11-10T17:45:00").getTime();
  const during = new Date("2026-11-10T18:20:00").getTime();

  it("enchaîne checkin → match → checkout → closed", () => {
    expect(assertStageTransition(card(), "checkin", inWindow)).toBe(true);

    const afterScan = card({
      stage: "checkin",
      checked_in_at: "2026-11-10T17:45:00",
      montant_restant: 0,
    });
    expect(assertStageTransition(afterScan, "match", during)).toBe(true);

    const afterMatch = card({
      stage: "match",
      checked_in_at: "2026-11-10T17:45:00",
      montant_restant: 0,
    });
    expect(assertStageTransition(afterMatch, "checkout", during)).toBe(true);

    const afterCheckout = card({
      stage: "checkout",
      checked_in_at: "2026-11-10T17:45:00",
      montant_restant: 0,
    });
    expect(assertStageTransition(afterCheckout, "closed", during)).toBe(true);
  });

  it("refuse le saut reserved → closed", () => {
    expect(() => assertStageTransition(card(), "closed", during)).toThrow();
  });
});
