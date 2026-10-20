import { describe, expect, it } from "vitest";
import {
  codeReservationValide,
  normaliserCodeReservation,
  parseQrPayload,
} from "@/lib/qrPayload";

/**
 * Miroir frontend de la normalisation backend
 * (backend/services/codeReservationService) : la saisie gérant doit être
 * comprise de la même façon des deux côtés, le serveur restant la vérité.
 */
describe("normaliserCodeReservation", () => {
  it.each([
    ["TF-774886", "TF-774886"],
    ["tf-774886", "TF-774886"],
    ["Tf-774886", "TF-774886"],
    ["TF774886", "TF-774886"],
    ["774886", "TF-774886"],
    ["tf 774 886", "TF-774886"],
    [" TF-774886 ", "TF-774886"],
    ["TF--774886", "TF-774886"],
    ["", ""],
  ])("normalise %s → %s", (saisie, attendu) => {
    expect(normaliserCodeReservation(saisie)).toBe(attendu);
  });

  it("distingue deux codes voisins", () => {
    expect(normaliserCodeReservation("TF-774886")).not.toBe(
      normaliserCodeReservation("TF-774887"),
    );
  });
});

describe("codeReservationValide", () => {
  it("accepte le format généré TF-XXXXXX", () => {
    expect(codeReservationValide(normaliserCodeReservation("774886"))).toBe(true);
  });
  it("accepte les anciens codes legacy", () => {
    expect(codeReservationValide("TF-MOH-2H")).toBe(true);
  });
  it("refuse n'importe quoi", () => {
    expect(codeReservationValide(normaliserCodeReservation("bonjour"))).toBe(false);
    expect(codeReservationValide("")).toBe(false);
  });
});

describe("cohérence avec parseQrPayload", () => {
  it("le code extrait d'un QR = le code saisi normalisé", () => {
    const parsed = parseQrPayload("TF-774886");
    expect(normaliserCodeReservation("tf 774886")).toBe(parsed.code);
  });
});
