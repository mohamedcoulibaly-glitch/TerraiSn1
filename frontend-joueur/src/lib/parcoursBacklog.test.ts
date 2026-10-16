import { describe, expect, it } from "vitest";
import { prixAfficheCarte } from "./prixCarte";
import { reservationAfficheQr, reservationVisibleJoueur } from "./reservationVisibilite";
import { isMobileWhatsApp } from "./openWhatsapp";

describe("parcours front backlog", () => {
  it("masque la carte tant que le paiement n'est pas confirmé", () => {
    expect(reservationVisibleJoueur({ statut: "en_attente_paiement" })).toBe(false);
    expect(reservationVisibleJoueur({ statut: "en_attente" })).toBe(false);
    expect(reservationVisibleJoueur({ statut: "confirme" })).toBe(true);
  });

  it("n'affiche le QR qu'une fois confirmé", () => {
    expect(reservationAfficheQr("en_attente_paiement")).toBe(false);
    expect(reservationAfficheQr("confirme")).toBe(true);
    expect(reservationAfficheQr("acceptee")).toBe(true);
  });

  it("affiche le demi-terrain par défaut sur la carte", () => {
    expect(
      prixAfficheCarte({ prix_carte_source: "demi", prix_moitie: 18000, prix_entier: 40000 }),
    ).toBe(18000);
    expect(prixAfficheCarte({ prix_affiche: 40000, prix_moitie: 18000 })).toBe(40000);
  });

  it("détecte le mobile pour ouvrir l'app WhatsApp", () => {
    expect(typeof isMobileWhatsApp()).toBe("boolean");
  });
});
