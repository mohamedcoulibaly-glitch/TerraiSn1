import { describe, expect, it } from "vitest";

/** Garde-fous payin joueur (miroir de Reservation.tsx). */
function assertCanalRequired(sansAvance: boolean, canal: string | null) {
  if (!sansAvance && !canal) return "Choisis Wave ou Orange Money pour payer";
  return null;
}

function assertPayUrl(url: string) {
  if (!/^https:\/\//i.test(url)) {
    return "Lien de paiement indisponible. La réservation n'est pas payée.";
  }
  return null;
}

function formatCheckoutError(message: string, code?: string) {
  const codeHint =
    code === "PAYTECH_CHECKOUT_FAILED"
      ? " (paiement en ligne indisponible — réessaie)"
      : code === "CANAL_PAIEMENT_REQUIS"
        ? " — choisis Wave ou Orange Money"
        : code
          ? ` [${code}]`
          : "";
  return `${message}${codeHint}`;
}

describe("paiement joueur — gardes", () => {
  it("exige un canal hors sans_avance", () => {
    expect(assertCanalRequired(false, null)).toMatch(/Wave/);
    expect(assertCanalRequired(false, "wave")).toBeNull();
    expect(assertCanalRequired(true, null)).toBeNull();
  });

  it("refuse un redirect non HTTPS", () => {
    expect(assertPayUrl("http://pay.local/x")).toMatch(/indisponible/);
    expect(assertPayUrl("https://paytech.sn/checkout/abc")).toBeNull();
  });

  it("enrichit le toast avec le code backend", () => {
    expect(formatCheckoutError("Erreur", "PAYTECH_CHECKOUT_FAILED")).toMatch(/indisponible/);
    expect(formatCheckoutError("Erreur", "CANAL_PAIEMENT_REQUIS")).toMatch(/Wave/);
  });
});
