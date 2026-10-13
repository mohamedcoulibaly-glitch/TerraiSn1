import { describe, expect, it } from "vitest";
import { estNuitProlongee, getJourPercu, trierCreneaux } from "./creneauLabel";

describe("creneauLabel — nuit prolongée", () => {
  it("détecte 00h–04h59 comme nuit prolongée", () => {
    expect(estNuitProlongee("01:00")).toBe(true);
    expect(estNuitProlongee("04:59")).toBe(true);
    expect(estNuitProlongee("05:00")).toBe(false);
    expect(estNuitProlongee("18:00")).toBe(false);
  });

  it("mappe mardi 01h → Nuit du lundi", () => {
    // 2026-10-13 = mardi
    const j = getJourPercu("2026-10-13", "01:00");
    expect(j.estNuitProlongee).toBe(true);
    expect(j.labelComplet).toMatch(/Nuit du Lundi/);
    expect(j.datePercue).toBe("2026-10-12");
  });

  it("trie 18h puis 22h puis 01h", () => {
    const sorted = trierCreneaux([
      { heure_debut: "01:00" },
      { heure_debut: "22:00" },
      { heure_debut: "18:00" },
    ] as any);
    expect(sorted.map((c: any) => c.heure_debut)).toEqual(["18:00", "22:00", "01:00"]);
  });
});
