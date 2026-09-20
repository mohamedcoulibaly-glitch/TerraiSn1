import { describe, expect, it } from "vitest";
import {
  parseHour,
  formatHour,
  jourDepuisDate,
  veilleJour,
  labelHeureSenegal,
  courtLabelHeureSenegal,
  hoursRangeFromHoraires,
} from "@/lib/scheduleSn";

describe("scheduleSn — calendrier culturel sénégalais", () => {
  it("parse et format heures", () => {
    expect(parseHour("18:00")).toBe(18);
    expect(parseHour("24:00")).toBe(24);
    expect(formatHour(0)).toBe("00:00");
    expect(formatHour(9)).toBe("09:00");
  });

  it("détecte les jours et la veille", () => {
    expect(jourDepuisDate("2026-09-14")).toBe("lundi");
    expect(jourDepuisDate("2026-09-18")).toBe("vendredi");
    expect(veilleJour("vendredi")).toBe("jeudi");
  });

  it("labellise Jeudi minuit pour vendredi 00:00", () => {
    expect(labelHeureSenegal("2026-09-18", "00:00")).toBe("Jeudi minuit");
    expect(courtLabelHeureSenegal("2026-09-18", "00:00")).toBe("Minuit");
    expect(labelHeureSenegal("2026-09-14", "18:00")).toBe("18:00");
  });

  it("respecte un fallback label", () => {
    expect(labelHeureSenegal("2026-09-18", "00:00", "Custom")).toBe("Custom");
  });

  it("génère la plage d'heures depuis horaires", () => {
    const hours = hoursRangeFromHoraires([
      { est_ouvert: 1, heure_debut: "08:00", heure_fin: "22:00" },
    ]);
    expect(hours[0]).toBe("08:00");
    expect(hours).toContain("21:00");
    expect(hours).not.toContain("22:00");
  });

  it("inclut 00:00 quand ouverture jusqu'à minuit", () => {
    const hours = hoursRangeFromHoraires([
      { est_ouvert: 1, heure_debut: "16:00", heure_fin: "00:00" },
    ]);
    expect(hours).toContain("00:00");
    expect(hours).toContain("16:00");
  });
});
