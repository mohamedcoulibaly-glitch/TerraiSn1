import { describe, expect, it } from "vitest";

type Portefeuille = {
  payout_mode?: "auto" | "retrait";
  bouton_retirer?: boolean;
  solde_demande_retrait?: number;
  message_lisible?: string | null;
};

function hintRetrait(p: Portefeuille) {
  if (p.solde_demande_retrait) return "Une demande est déjà en cours de traitement.";
  if (p.bouton_retirer) return "Le montant est envoyé à l’équipe pour validation et versement.";
  return p.message_lisible || "Le retrait devient disponible après validation du canal Wave ou Orange Money et des revenus.";
}

function canClickRetirer(p: Portefeuille, pending: boolean) {
  return p.payout_mode === "retrait" && Boolean(p.bouton_retirer) && !pending;
}

describe("retrait gérant — gardes UI", () => {
  it("active le bouton seulement si bouton_retirer", () => {
    expect(canClickRetirer({ payout_mode: "retrait", bouton_retirer: true }, false)).toBe(true);
    expect(canClickRetirer({ payout_mode: "retrait", bouton_retirer: false }, false)).toBe(false);
    expect(canClickRetirer({ payout_mode: "auto", bouton_retirer: true }, false)).toBe(false);
  });

  it("affiche le message_lisible quand le bouton est grisé", () => {
    expect(
      hintRetrait({
        bouton_retirer: false,
        message_lisible: "Aucun canal Wave/OM vérifié",
      }),
    ).toBe("Aucun canal Wave/OM vérifié");
  });
});
