import { describe, expect, it } from "vitest";
import { formatPhoneDisplay, isValidSenegalMobile, toLocal9 } from "./phone";

describe("toLocal9", () => {
  it("garde les 9 chiffres locaux pendant la saisie", () => {
    let value = "";
    for (const digit of "771234567") {
      value = formatPhoneDisplay(value + digit);
    }
    expect(toLocal9(value)).toBe("771234567");
    expect(formatPhoneDisplay(value)).toBe("77 123 45 67");
  });

  it("retire l'indicatif 221 collé avec le numéro", () => {
    expect(toLocal9("+221771234567")).toBe("771234567");
    expect(toLocal9("221 77 123 45 67")).toBe("771234567");
    expect(formatPhoneDisplay("+221771234567")).toBe("77 123 45 67");
  });

  it("n'avale pas le premier chiffre quand on tape un 10e", () => {
    expect(toLocal9("7712345678")).toBe("771234567");
  });

  it("valide un mobile sénégalais", () => {
    expect(isValidSenegalMobile("77 123 45 67")).toBe(true);
    expect(isValidSenegalMobile("221771234567")).toBe(true);
    expect(isValidSenegalMobile("33 123 45 67")).toBe(false);
  });
});
