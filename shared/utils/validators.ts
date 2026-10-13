/** Validateurs partagés (téléphone Sénégal, email) */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(String(value || "").trim());
}

/** Normalise un mobile SN vers 9 chiffres locaux (7xxxxxxxx). */
export function toLocal9(telephone: string): string {
  let digits = String(telephone || "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("221") && digits.length >= 12) digits = digits.slice(3);
  if (digits.length === 10 && digits.startsWith("07")) digits = digits.slice(1);
  return digits.slice(0, 9);
}

export function isValidSenegalMobile(telephone: string): boolean {
  const local = toLocal9(telephone);
  return /^7[0-9]{8}$/.test(local);
}
