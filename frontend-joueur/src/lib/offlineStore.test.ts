import { describe, expect, it } from "vitest";
import {
  reservationHasStadiumAccess,
  stripQrDataUrls,
  toCachedReservation,
} from "./offlineStore";

describe("offlineStore — accès terrain", () => {
  it("autorise les statuts confirmés", () => {
    expect(reservationHasStadiumAccess("confirme")).toBe(true);
    // QR in-app uniquement si statut === confirme (pas acceptee / en_attente)
    expect(reservationHasStadiumAccess("acceptee")).toBe(false);
    expect(reservationHasStadiumAccess("en_attente")).toBe(false);
    expect(reservationHasStadiumAccess("annule")).toBe(false);
  });

  it("préserve le QR data URL précédent lors du merge", () => {
    const previous = toCachedReservation({
      id: 7,
      terrain_id: 1,
      terrain_nom: "Terrain A",
      date: "2026-10-12",
      heure_debut: "18:00",
      heure_fin: "19:00",
      statut: "confirme",
      code_reservation: "ABC123",
      qr_code_data_url: "data:image/png;base64,xxx",
    });

    const merged = toCachedReservation(
      {
        id: 7,
        terrain_id: 1,
        terrain_nom: "Terrain A",
        date: "2026-10-12",
        heure_debut: "18:00",
        heure_fin: "19:00",
        statut: "confirme",
        code_reservation: "ABC123",
      },
      previous,
    );

    expect(merged.qr_code_data_url).toBe("data:image/png;base64,xxx");
    expect(merged.code_reservation).toBe("ABC123");
  });

  it("retire les data URL avant persistance légère", () => {
    const stripped = stripQrDataUrls([
      {
        id: 1,
        qr_code_data_url: "data:image/png;base64,heavy",
        code_reservation: "X1",
      },
    ]);
    expect(stripped[0].code_reservation).toBe("X1");
    expect(stripped[0].qr_code_data_url).toBeUndefined();
  });
});
