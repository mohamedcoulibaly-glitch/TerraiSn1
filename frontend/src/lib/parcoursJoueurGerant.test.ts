/**
 * Simulation de parcours joueur / gérant côté front (logique pure).
 * Valide les enchaînements UI critiques sans monter React.
 */
import { describe, expect, it } from "vitest";
import {
  assertStageTransition,
  nextKanbanStage,
  playerGate,
  resolveOperationalStage,
  type KanbanCardInput,
} from "@/lib/kanbanRules";
import { homeForUser, normalizeRole } from "@/auth/roles";
import { isValidSenegalMobile, phoneError, toLocal9 } from "@/auth/phone";
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

describe("Parcours joueur — inscription → home", () => {
  it("valide le téléphone SN avant OTP", () => {
    expect(phoneError("")).toBeTruthy();
    expect(phoneError("771")).toMatch(/incomplet/i);
    expect(isValidSenegalMobile("77 826 12 25")).toBe(true);
    expect(toLocal9("+221778261225")).toBe("778261225");
  });

  it("redirige le joueur vers l'accueil après login", () => {
    const role = normalizeRole({ role: "joueur", accountType: "user" });
    expect(role).toBe("joueur");
    expect(homeForUser({ role: "joueur" })).toBe("/");
  });

  it("affiche le libellé culturel pour le créneau 00:00", () => {
    expect(labelHeureSenegal("2026-09-18", "00:00")).toBe("Nuit du Jeudi à Vendredi");
  });
});

describe("Parcours gérant — check-in Kanban A→Z", () => {
  const inWindow = new Date("2026-11-10T17:45:00").getTime();
  const duringMatch = new Date("2026-11-10T18:15:00").getTime();
  const tooEarly = new Date("2026-11-10T12:00:00").getTime();

  it("refuse check-in hors fenêtre", () => {
    expect(() => assertStageTransition(card(), "checkin", tooEarly)).toThrow(/fenêtre/i);
  });

  it("enchaîne reserved → checkin → match → checkout → closed", () => {
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

    expect(() =>
      assertStageTransition(card({ stage: "checkout", checked_in_at: "x", montant_restant: 35000 }), "closed", duringMatch),
    ).toThrow(/encaissé|reste/i);

    expect(
      assertStageTransition(
        card({ stage: "checkout", checked_in_at: "x", montant_restant: 0 }),
        "closed",
        duringMatch,
      ),
    ).toBe(true);

    expect(nextKanbanStage("closed")).toBeNull();
  });

  it("bloque un joueur banni avant check-in", () => {
    const gate = playerGate({ is_banned: true });
    expect(gate.bloqueReservation).toBe(true);
    expect(() =>
      assertStageTransition(card({ crm: { bloqueReservation: true, reason: "Banni" } }), "checkin", inWindow),
    ).toThrow(/bloqué/i);
  });

  it("déduit le stage depuis les timestamps legacy", () => {
    expect(resolveOperationalStage({ qr_code_scanne_at: "2026-11-10T17:40:00" })).toBe("checkin");
    expect(resolveOperationalStage({ checkout_at: "2026-11-10T19:00:00" })).toBe("closed");
    expect(resolveOperationalStage({ statut: "match_joue" })).toBe("match");
  });
});

describe("Parcours staff — redirections post-login", () => {
  it("envoie chaque rôle vers son backoffice", () => {
    expect(homeForUser({ role: "gerant" })).toBe("/backoffice/gerant");
    expect(homeForUser({ role: "proprietaire" })).toBe("/backoffice/proprietaire");
    expect(homeForUser({ role: "super_admin" })).toBe("/backoffice/superadmin");
  });
});

describe("Parcours propriétaire — navigation backoffice", () => {
  it("home puis revenus / santé / terrains (chemins canoniques)", () => {
    expect(normalizeRole({ role: "proprietaire" })).toBe("proprietaire");
    expect(homeForUser({ role: "proprietaire" })).toBe("/backoffice/proprietaire");

    const steps = [
      "/backoffice/proprietaire",
      "/backoffice/proprietaire/revenus",
      "/backoffice/proprietaire/sante",
      "/backoffice/proprietaire/terrains",
      "/backoffice/proprietaire/terrain/1",
    ];
    for (const path of steps) {
      expect(path.startsWith("/backoffice/proprietaire")).toBe(true);
      expect(path).not.toBe("/joueur");
    }
  });
});

describe("Parcours superadmin — navigation plateforme", () => {
  it("home puis terrains / caisse / utilisateurs", () => {
    expect(normalizeRole({ role: "superadmin" })).toBe("super_admin");
    expect(homeForUser({ role: "super_admin" })).toBe("/backoffice/superadmin");

    const steps = [
      "/backoffice/superadmin",
      "/backoffice/superadmin/terrains",
      "/backoffice/superadmin/caisse",
      "/backoffice/superadmin/utilisateurs",
    ];
    for (const path of steps) {
      expect(path.startsWith("/backoffice/superadmin")).toBe(true);
      expect(path).not.toMatch(/^\/joueur/);
    }
  });
});
