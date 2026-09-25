/**
 * Parcours métier complets — logique pure (pas de montage React).
 */
import { describe, expect, it } from "vitest";
import { homeForUser, normalizeRole, profileForUser, ROLE_HOME } from "@/auth/roles";
import { isValidSenegalMobile, phoneError, toLocal9 } from "@/auth/phone";
import {
  assertStageTransition,
  nextKanbanStage,
  type KanbanCardInput,
} from "@/lib/kanbanRules";
import { ROUTE_MAP } from "@/router/routesParRole";
import { overlayFromBackend } from "@/lib/saContrat";
import { labelHeureSenegal } from "@/lib/scheduleSn";

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

/** Étapes UI joueur simulées (chemins). */
const JOUEUR_RESERVE_FLOW = [
  "/",
  "/explorer",
  "/terrain/42",
  "/paiement/42",
  "/reservation/succes",
] as const;

describe("Parcours joueur — téléphone → home → réservation → succès", () => {
  it("valide le téléphone SN puis enchaîne le flux de réservation", () => {
    expect(phoneError("")).toBeTruthy();
    expect(isValidSenegalMobile("77 826 12 25")).toBe(true);
    expect(toLocal9("+221778261225")).toBe("778261225");

    const role = normalizeRole({ role: "joueur", accountType: "user" });
    expect(role).toBe("joueur");
    expect(homeForUser({ role: "joueur" })).toBe("/");
    expect(homeForUser({ role: "joueur" })).toBe(ROUTE_MAP.joueur.home);

    let step = 0;
    for (const path of JOUEUR_RESERVE_FLOW) {
      step += 1;
      expect(path).not.toBe("/joueur");
      if (step === 1) expect(path).toBe(ROLE_HOME.joueur);
      if (step === JOUEUR_RESERVE_FLOW.length) expect(path).toBe("/reservation/succes");
    }
    expect(JOUEUR_RESERVE_FLOW).toContain("/");
    expect(ROUTE_MAP.joueur.routes).toContain("/reservation/succes");
    expect(profileForUser({ role: "joueur" })).toBe("/profil/joueur");
  });
});

describe("Parcours gérant — home → kanban checkin→match→checkout→closed", () => {
  const inWindow = new Date("2026-11-10T17:45:00").getTime();
  const duringMatch = new Date("2026-11-10T18:15:00").getTime();

  it("atterrit sur le backoffice puis clôture avec paiement", () => {
    expect(homeForUser({ role: "gerant" })).toBe("/backoffice/gerant");
    expect(homeForUser({ role: "employe" })).toBe(ROUTE_MAP.gerant.home);

    expect(assertStageTransition(card(), "checkin", inWindow)).toBe(true);

    const afterCheckin = card({
      stage: "checkin",
      checked_in_at: "2026-11-10T17:45:00",
    });
    expect(assertStageTransition(afterCheckin, "match", duringMatch)).toBe(true);

    const afterMatch = card({
      stage: "match",
      checked_in_at: "2026-11-10T17:45:00",
    });
    expect(assertStageTransition(afterMatch, "checkout", duringMatch)).toBe(true);

    expect(
      assertStageTransition(
        card({ stage: "checkout", checked_in_at: "x", montant_restant: 0 }),
        "closed",
        duringMatch,
      ),
    ).toBe(true);
    expect(nextKanbanStage("closed")).toBeNull();

    expect(ROUTE_MAP.gerant.routes).toContain("/backoffice/gerant/joueurs");
    expect(profileForUser({ role: "gerant" })).toBe("/profil/gerant");
  });
});

describe("Parcours propriétaire — home → revenus → santé → terrains", () => {
  it("enchaîne les écrans backoffice propriétaire", () => {
    expect(normalizeRole({ role: "proprietaire" })).toBe("proprietaire");
    expect(homeForUser({ role: "proprietaire" })).toBe("/backoffice/proprietaire");

    const journey = [
      ROUTE_MAP.proprietaire.home,
      "/backoffice/proprietaire/revenus",
      "/backoffice/proprietaire/sante",
      "/backoffice/proprietaire/terrains",
    ];
    for (const path of journey) {
      expect(ROUTE_MAP.proprietaire.routes).toContain(path);
      expect(path).not.toBe("/joueur");
    }
    expect(profileForUser({ role: "proprietaire" })).toBe("/profil/proprietaire");
  });
});

describe("Parcours superadmin — home → terrains → caisse → utilisateurs", () => {
  it("enchaîne les modules plateforme + contrat", () => {
    expect(normalizeRole({ role: "superadmin" })).toBe("super_admin");
    expect(homeForUser({ role: "super_admin" })).toBe("/backoffice/superadmin");

    const journey = [
      ROUTE_MAP.super_admin.home,
      "/backoffice/superadmin/terrains",
      "/backoffice/superadmin/caisse",
      "/backoffice/superadmin/utilisateurs",
    ];
    for (const path of journey) {
      expect(ROUTE_MAP.super_admin.routes).toContain(path);
    }

    const contrat = overlayFromBackend({
      wave_numero: "221771234567",
      wave_statut: "verifie",
      om_statut: "verifie",
      payout_mode: "auto",
      paiement_production: 1,
    });
    expect(contrat.production_paiement).toBe(true);
    expect(contrat.payout_mode).toBe("auto");
    expect(profileForUser({ role: "super_admin" })).toBe("/profil/admin");
  });
});

describe("Parcours — libellé créneau culturel partagé", () => {
  it("labelHeureSenegal reste cohérent sur le parcours joueur", () => {
    expect(labelHeureSenegal("2026-09-18", "00:00")).toBe("Nuit du Jeudi à Vendredi");
  });
});
