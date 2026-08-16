import { describe, expect, it } from "vitest";
import {
  assertStageTransition,
  KanbanGateError,
  nextKanbanStage,
  playerGate,
  resolveOperationalStage,
  type KanbanCardInput,
} from "@/lib/kanbanRules";

const slot = {
  date: "2026-08-10",
  heure_debut: "18:00",
  heure_fin: "19:00",
  fenetre_retard: 30,
};

function card(overrides: Partial<KanbanCardInput> = {}): KanbanCardInput {
  return {
    stage: "reserved",
    statut: "confirme",
    ...slot,
    checked_in_at: null,
    montant_restant: 35000,
    crm: { bloqueReservation: false },
    ...overrides,
  };
}

describe("playerGate", () => {
  it("bloque un joueur banni", () => {
    expect(playerGate({ is_banned: true }).bloqueReservation).toBe(true);
  });

  it("ne bloque pas un impayé sans politique terrain", () => {
    expect(playerGate({ solde_ouvert: 12000 }).bloqueReservation).toBe(false);
  });

  it("bloque un impayé si politiqueImpaye", () => {
    expect(playerGate({ solde_ouvert: 1, politiqueImpaye: true }).reason).toBe("Impayé");
  });
});

describe("resolveOperationalStage", () => {
  it("lit la colonne si elle est valide", () => {
    expect(resolveOperationalStage({ operational_stage: "checkout" })).toBe("checkout");
  });

  it("déduit check-in depuis qr_code_scanne_at", () => {
    expect(resolveOperationalStage({ qr_code_scanne_at: "2026-08-10T17:05:00" })).toBe("checkin");
  });

  it("déduit match depuis match_joue si stage absent", () => {
    expect(resolveOperationalStage({ statut: "match_joue" })).toBe("match");
  });
});

describe("assertStageTransition", () => {
  const inWindow = new Date("2026-08-10T17:30:00").getTime();
  const duringMatch = new Date("2026-08-10T18:10:00").getTime();
  const beforeMatch = new Date("2026-08-10T16:00:00").getTime();

  it("interdit reserved → match", () => {
    try {
      assertStageTransition(card(), "match", inWindow);
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(KanbanGateError);
      expect((e as KanbanGateError).code).toBe("ILLEGAL_TRANSITION");
    }
  });

  it("autorise reserved → checkin dans la fenêtre", () => {
    expect(assertStageTransition(card(), "checkin", inWindow)).toBe(true);
  });

  it("refuse le check-in trop tôt", () => {
    try {
      assertStageTransition(card(), "checkin", beforeMatch);
      throw new Error("expected throw");
    } catch (e) {
      expect((e as KanbanGateError).code).toBe("OUT_OF_WINDOW");
    }
  });

  it("refuse le match sans checked_in_at", () => {
    try {
      assertStageTransition(card({ stage: "checkin" }), "match", duringMatch);
      throw new Error("expected throw");
    } catch (e) {
      expect((e as KanbanGateError).code).toBe("CHECKIN_REQUIRED");
    }
  });

  it("autorise checkin → match après check-in", () => {
    expect(
      assertStageTransition(
        card({ stage: "checkin", checked_in_at: "2026-08-10T17:05:00" }),
        "match",
        duringMatch,
      ),
    ).toBe(true);
  });

  it("refuse checkout avant heure_debut", () => {
    try {
      assertStageTransition(
        card({ stage: "match", checked_in_at: "2026-08-10T17:05:00" }),
        "checkout",
        inWindow,
      );
      throw new Error("expected throw");
    } catch (e) {
      expect((e as KanbanGateError).code).toBe("MATCH_NOT_STARTED");
    }
  });

  it("refuse closed si solde ouvert sans waiver", () => {
    try {
      assertStageTransition(
        card({
          stage: "checkout",
          checked_in_at: "2026-08-10T17:05:00",
          montant_restant: 1000,
        }),
        "closed",
        duringMatch,
      );
      throw new Error("expected throw");
    } catch (e) {
      expect((e as KanbanGateError).code).toBe("BALANCE_OPEN");
    }
  });

  it("autorise closed avec waiver gérant", () => {
    expect(
      assertStageTransition(
        card({
          stage: "checkout",
          checked_in_at: "2026-08-10T17:05:00",
          montant_restant: 1000,
          waiverEncaissement: true,
        }),
        "closed",
        duringMatch,
      ),
    ).toBe(true);
  });

  it("bloque le DnD si CRM gate", () => {
    try {
      assertStageTransition(card({ crm: { bloqueReservation: true, reason: "Banni" } }), "checkin", inWindow);
      throw new Error("expected throw");
    } catch (e) {
      expect((e as KanbanGateError).code).toBe("PLAYER_BLOCKED");
      expect((e as KanbanGateError).statusCode).toBe(409);
    }
  });
});

describe("nextKanbanStage", () => {
  it("suit reserved → checkin → match → checkout → closed", () => {
    expect(nextKanbanStage("reserved")).toBe("checkin");
    expect(nextKanbanStage("checkin")).toBe("match");
    expect(nextKanbanStage("match")).toBe("checkout");
    expect(nextKanbanStage("checkout")).toBe("closed");
    expect(nextKanbanStage("closed")).toBeNull();
  });
});
