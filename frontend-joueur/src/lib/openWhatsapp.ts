function digits(raw: string): string {
  let numero = String(raw || "").replace(/\D/g, "");
  if (numero.startsWith("00")) numero = numero.slice(2);
  if (numero.startsWith("0") && numero.length === 10) numero = numero.slice(1);
  if (numero.length === 9) numero = `221${numero}`;
  return numero;
}

export function isMobileWhatsApp(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

/** Ouvre l'app WhatsApp sur mobile, wa.me sur ordinateur. Jamais WhatsApp Web (US-11). */
export function openWhatsAppChat(rawPhone: string, text = ""): boolean {
  const numero = digits(rawPhone);
  if (!numero || numero.length < 11) return false;
  const encoded = encodeURIComponent(text);
  if (isMobileWhatsApp()) {
    window.location.assign(`whatsapp://send?phone=${numero}&text=${encoded}`);
    return true;
  }
  window.open(`https://wa.me/${numero}?text=${encoded}`, "_blank", "noopener,noreferrer");
  return true;
}

/** Href prêt pour <a> — app native sur mobile, wa.me sur desktop. */
export function whatsAppHref(rawPhone: string, text = ""): string | null {
  const numero = digits(rawPhone);
  if (!numero || numero.length < 11) return null;
  const encoded = encodeURIComponent(text);
  if (isMobileWhatsApp()) return `whatsapp://send?phone=${numero}&text=${encoded}`;
  return `https://wa.me/${numero}?text=${encoded}`;
}
