import { describe, it, expect } from "vitest";
import { contratDepuisTerrain, overlayFromBackend } from "./saContrat";

describe("contrat superadmin", () => {
  it("mappe le contrat serveur (production + Wave)", () => {
    const overlay = overlayFromBackend({
      wave_numero: "221771234567",
      wave_statut: "verifie",
      om_statut: "verifie",
      payout_mode: "auto",
      paiement_production: 1,
      remboursement_autorise: 0,
    });
    expect(overlay.wave_numero).toBe("221771234567");
    expect(overlay.payout_mode).toBe("auto");
    expect(overlay.production_paiement).toBe(true);
    expect(overlay.remboursement_autorise).toBe(false);
  });

  it("ne laisse pas un cache local écraser Wave / mode du serveur", () => {
    const overlay = contratDepuisTerrain({
      id: 9,
      wave_numero: "221770000000",
      wave_statut: "verifie",
      om_statut: "saisi",
      payout_mode: "retrait",
      paiement_production: 0,
      contrat_resume: { payout_mode: "retrait", wave_om_verifies: true },
    });
    expect(overlay.wave_numero).toBe("221770000000");
    expect(overlay.payout_mode).toBe("retrait");
    expect(overlay.production_paiement).toBe(false);
  });
});
