import { describe, expect, it } from "vitest";
import { prixAfficheCarte } from "./prixCarte";
import { reservationAfficheQr, reservationVisibleJoueur } from "./reservationVisibilite";
import { isMobileWhatsApp, whatsAppHref } from "./openWhatsapp";
import { reservationHasStadiumAccess } from "./offlineStore";

describe("parcours front backlog", () => {
  it("US-04 masque la carte tant que le paiement n'est pas confirmé", () => {
    expect(reservationVisibleJoueur({ statut: "en_attente_paiement" })).toBe(false);
    expect(reservationVisibleJoueur({ statut: "en_attente" })).toBe(false);
    expect(reservationVisibleJoueur({ statut: "expire" })).toBe(false);
    expect(reservationVisibleJoueur({ statut: "confirme" })).toBe(true);
  });

  it("US-17 n'affiche le QR / pass qu'une fois confirmé", () => {
    expect(reservationAfficheQr("en_attente_paiement")).toBe(false);
    expect(reservationAfficheQr("confirme")).toBe(true);
    expect(reservationAfficheQr("acceptee")).toBe(true);
    expect(reservationHasStadiumAccess("en_attente")).toBe(false);
    expect(reservationHasStadiumAccess("confirme")).toBe(true);
  });

  it("US-22 affiche le demi-terrain par défaut sur la carte", () => {
    expect(
      prixAfficheCarte({ prix_carte_source: "demi", prix_moitie: 18000, prix_entier: 40000 }),
    ).toBe(18000);
    expect(prixAfficheCarte({ prix_affiche: 40000, prix_moitie: 18000 })).toBe(40000);
  });

  it("US-11 produit un lien WhatsApp sans WhatsApp Web", () => {
    expect(typeof isMobileWhatsApp()).toBe("boolean");
    const href = whatsAppHref("771234567", "bonjour");
    expect(href).toBeTruthy();
    expect(href).not.toMatch(/web\.whatsapp\.com/);
    expect(href).toMatch(/^(whatsapp:\/\/|https:\/\/wa\.me\/)/);
  });
});
