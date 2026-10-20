/**
 * Parse du contenu QR côté frontend (JSON métier + legacy).
 */
export function parseQrPayload(rawValue: string): { id: string; code: string; raw: string } {
  const raw = String(rawValue || "").trim();
  if (raw.startsWith("{")) {
    try {
      const data = JSON.parse(raw) as { reservation_id?: number | string; code?: string };
      return {
        id: data.reservation_id != null ? String(data.reservation_id) : "",
        code: String(data.code || "").toUpperCase(),
        raw,
      };
    } catch {
      return { id: "", code: "", raw };
    }
  }
  const urlMatch = raw.match(/(?:reservation_id|id)=([0-9]+)/i);
  if (urlMatch) return { id: urlMatch[1], code: "", raw };
  const pathMatch = raw.match(/reservations?\/([0-9]+)/i);
  if (pathMatch) return { id: pathMatch[1], code: "", raw };
  const codeMatch = raw.match(/\b(TF-[A-Z0-9-]+)\b/i);
  if (codeMatch) return { id: "", code: codeMatch[1].toUpperCase(), raw };
  const numberMatch = raw.match(/\b([0-9]{1,12})\b/);
  return { id: numberMatch?.[1] || "", code: "", raw };
}

/**
 * Normalisation du code numérique saisi par le gérant — MIROIR du backend
 * (services/codeReservationService) : 'tf 774 886', 'TF774886', '774886'
 * → 'TF-774886'. Le serveur reste la source de vérité et re-normalise.
 */
export function normaliserCodeReservation(saisie: string): string {
  const brut = String(saisie || "").trim().toUpperCase().replace(/[\s.]/g, "");
  if (!brut) return "";
  if (/^\d{6}$/.test(brut)) return `TF-${brut}`;
  if (/^TF\d{6}$/.test(brut)) return `TF-${brut.slice(2)}`;
  if (/^TF-[A-Z0-9-]+$/.test(brut)) return brut.replace(/-{2,}/g, "-");
  return brut;
}

export function codeReservationValide(codeNormalise: string): boolean {
  return /^TF-\d{6}$/.test(codeNormalise) || /^TF-[A-Z0-9][A-Z0-9-]{2,}$/.test(codeNormalise);
}
