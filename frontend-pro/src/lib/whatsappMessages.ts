export const WHATSAPP_INFRA_MESSAGE =
  "Y'a un problème avec WhatsApp. Contactez le développeur immédiatement.";

export function isWhatsappInfraDown(payload: { ok?: boolean; infra_ok?: boolean; mock?: boolean; error?: string | null } | null) {
  if (!payload) return false;
  if (payload.ok === false || payload.infra_ok === false) return true;
  if (payload.mock) return true;
  if (payload.error && /problème avec WhatsApp/i.test(payload.error)) return true;
  return false;
}

export function confirmWhatsappAction(_down: boolean) {
  return true;
}
