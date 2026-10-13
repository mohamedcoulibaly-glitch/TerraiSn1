import { describe, expect, it } from "vitest";
import {
  calculerFenetreCheckIn,
  estDansLaFenetreCheckIn,
  DEFAULT_FENETRE_RETARD_MIN,
} from "@/lib/checkInFenetre";
import { parseQrPayload } from "@/lib/qrPayload";

describe("estDansLaFenetreCheckIn", () => {
  const base = {
    date: "2026-08-10",
    heure_debut: "18:00",
    heure_fin: "19:00",
    fenetre_retard: 30,
  };

  it("ouvre 1h avant le match", () => {
    const { debutFenetre, finFenetre } = calculerFenetreCheckIn(base);
    // 17:00
    expect(new Date(debutFenetre).getHours()).toBe(17);
    // 19:00 + 30min + 2h = 21:30
    expect(new Date(finFenetre).getHours()).toBe(21);
    expect(new Date(finFenetre).getMinutes()).toBe(30);
  });

  it("est false trop tôt", () => {
    const avant = new Date("2026-08-10T16:30:00").getTime();
    expect(estDansLaFenetreCheckIn(base, avant)).toBe(false);
  });

  it("est true dans la fenêtre", () => {
    const ok = new Date("2026-08-10T18:15:00").getTime();
    expect(estDansLaFenetreCheckIn(base, ok)).toBe(true);
  });

  it("est false trop tard (après +retard +2h)", () => {
    const tropTard = new Date("2026-08-10T21:31:00").getTime();
    expect(estDansLaFenetreCheckIn(base, tropTard)).toBe(false);
  });

  it("utilise 30 min par défaut", () => {
    const { retardMin } = calculerFenetreCheckIn({
      date: "2026-08-10",
      heure_debut: "10:00",
      heure_fin: "11:00",
    });
    expect(retardMin).toBe(DEFAULT_FENETRE_RETARD_MIN);
  });
});

describe("parseQrPayload", () => {
  it("parse le JSON métier", () => {
    const raw = JSON.stringify({
      reservation_id: 8,
      code: "TF-MOH-2H",
      creneau_id: 1,
      terrain_id: 9,
      expire_at: 1720000000,
    });
    const parsed = parseQrPayload(raw);
    expect(parsed.id).toBe("8");
    expect(parsed.code).toBe("TF-MOH-2H");
    expect(parsed.raw).toBe(raw);
  });

  it("parse un code legacy TF-", () => {
    const parsed = parseQrPayload("TF-MOH-2H");
    expect(parsed.code).toBe("TF-MOH-2H");
    expect(parsed.id).toBe("");
  });
});
