/** Validation & format téléphone mobile sénégalais 7X XXX XX XX */

export function digitsOnly(value: string): string {
  return String(value || "").replace(/\D/g, "");
}

/** Retourne les 9 chiffres locaux (7XXXXXXXX) ou "". */
export function toLocal9(value: string): string {
  let d = digitsOnly(value);
  if (d.startsWith("00")) d = d.slice(2);
  // Indicatif déjà affiché à côté du champ (+221) : le retirer dès qu'il est saisi / collé.
  if (d.startsWith("221")) d = d.slice(3);
  if (d.startsWith("0")) d = d.slice(1);
  return d.slice(0, 9);
}

export function isValidSenegalMobile(value: string): boolean {
  const local = toLocal9(value);
  return /^7[0-9]\d{7}$/.test(local);
}

/** Affichage: 77 123 45 67 */
export function formatPhoneDisplay(value: string): string {
  const local = toLocal9(value).slice(0, 9);
  const parts = [
    local.slice(0, 2),
    local.slice(2, 5),
    local.slice(5, 7),
    local.slice(7, 9),
  ].filter(Boolean);
  return parts.join(" ");
}

export function phoneError(value: string): string | null {
  const local = toLocal9(value);
  if (!local) return "Numéro de téléphone requis";
  if (local.length < 9) return "Numéro incomplet (7X XXX XX XX)";
  if (!local.startsWith("7")) return "Le numéro doit commencer par 7";
  if (!isValidSenegalMobile(local)) return "Format invalide : 7X XXX XX XX";
  return null;
}
