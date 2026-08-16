/** Calendrier culturel sénégalais — labels créneaux */

const JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"] as const;
const JOURS_LABEL: Record<string, string> = {
  dimanche: "Dimanche",
  lundi: "Lundi",
  mardi: "Mardi",
  mercredi: "Mercredi",
  jeudi: "Jeudi",
  vendredi: "Vendredi",
  samedi: "Samedi",
};

export function parseHour(time: string | number | undefined | null): number {
  const raw = String(time ?? "0").trim();
  if (raw === "24:00" || raw === "24") return 24;
  return parseInt(raw.split(":")[0], 10) || 0;
}

export function formatHour(h: number): string {
  if (h === 24) return "00:00";
  const n = ((h % 24) + 24) % 24;
  return `${String(n).padStart(2, "0")}:00`;
}

export function jourDepuisDate(dateStr: string): string {
  const d = new Date(`${String(dateStr).slice(0, 10)}T12:00:00`);
  return JOURS[d.getDay()] || "lundi";
}

export function veilleJour(jour: string): string {
  const idx = JOURS.indexOf(jour as (typeof JOURS)[number]);
  if (idx < 0) return "jeudi";
  return JOURS[(idx + 6) % 7];
}

/** Vendredi 00:00 → « Jeudi minuit » */
export function labelHeureSenegal(dateStr: string, heureDebut: string, fallbackLabel?: string): string {
  if (fallbackLabel) return fallbackLabel;
  const h = parseHour(heureDebut);
  if (h === 0 || h === 24) {
    const veille = veilleJour(jourDepuisDate(dateStr));
    return `${JOURS_LABEL[veille] || "Veille"} minuit`;
  }
  return formatHour(h);
}

export function courtLabelHeureSenegal(dateStr: string, heureDebut: string, fallback?: string): string {
  if (fallback) return fallback;
  const h = parseHour(heureDebut);
  if (h === 0 || h === 24) return "Minuit";
  return formatHour(h);
}

export function hoursRangeFromHoraires(
  horaires: Array<{ heure_debut?: string; heure_fin?: string; est_ouvert?: number | boolean }>,
  fallback: { min: number; max: number } = { min: 6, max: 24 },
): string[] {
  let min = fallback.min;
  let max = fallback.max;
  let found = false;
  for (const h of horaires || []) {
    if (h.est_ouvert === 0 || h.est_ouvert === false) continue;
    const s = parseHour(h.heure_debut);
    let e = parseHour(h.heure_fin);
    if (!h.heure_fin || String(h.heure_fin).startsWith("00")) e = 24;
    if (!found) {
      min = s;
      max = e;
      found = true;
    } else {
      min = Math.min(min, s);
      max = Math.max(max, e);
    }
  }
  if (max >= 24) min = Math.min(min, 0);
  const slots: string[] = [];
  for (let h = Math.max(0, min); h < Math.min(24, max); h += 1) {
    slots.push(formatHour(h));
  }
  // Toujours proposer 00:00 si max atteint minuit (affichage culture)
  if (max >= 24 && !slots.includes("00:00")) {
    slots.unshift("00:00");
  }
  return slots;
}

export { JOURS, JOURS_LABEL };
