import type { Select2Option } from "@/components/Select2";

/** 8h … 23h, -------, 00h … 5h, -----, 6h 7h */
const BLOC_JOUR = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23];
const BLOC_NUIT = [0, 1, 2, 3, 4, 5];
const BLOC_MATIN = [6, 7];

const JOURS_ORDRE = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"] as const;

const JOUR_LABELS: Record<string, string> = {
  lundi: "Lundi",
  mardi: "Mardi",
  mercredi: "Mercredi",
  jeudi: "Jeudi",
  vendredi: "Vendredi",
  samedi: "Samedi",
  dimanche: "Dimanche",
};

export function labelHeureCourte(hhmm: string): string {
  const h = parseInt(String(hhmm || "").slice(0, 2), 10);
  if (!Number.isFinite(h)) return String(hhmm || "");
  if (h === 0) return "00h";
  return `${h}h`;
}

/** Lundi 00h–5h → « nuit du Lundi à Mardi » */
export function labelNuitDuJourASuivant(jour: string): string {
  const key = String(jour || "").toLowerCase();
  const i = JOURS_ORDRE.indexOf(key as (typeof JOURS_ORDRE)[number]);
  const from = JOUR_LABELS[key] || "Lundi";
  const toKey = i >= 0 ? JOURS_ORDRE[(i + 1) % 7] : "mardi";
  return `nuit du ${from} à ${JOUR_LABELS[toKey]}`;
}

function toOpt(h: number, jour?: string): Select2Option {
  const value = `${String(h).padStart(2, "0")}:00`;
  const base = labelHeureCourte(value);
  if (h <= 5) {
    const nuit = jour ? labelNuitDuJourASuivant(jour) : "nuit";
    return { value, label: `${base} · ${nuit}` };
  }
  return { value, label: base };
}

export function optionsHeuresSelect2(valeurActuelle?: string, jour?: string): Select2Option[] {
  const opts: Select2Option[] = [
    ...BLOC_JOUR.map((h) => toOpt(h)),
    { value: "__sep-nuit", label: "-------", disabled: true, separator: true },
    ...BLOC_NUIT.map((h) => toOpt(h, jour)),
    { value: "__sep-matin", label: "-----", disabled: true, separator: true },
    ...BLOC_MATIN.map((h) => toOpt(h)),
  ];
  const v = String(valeurActuelle || "").slice(0, 5);
  if (!v || opts.some((o) => o.value === v)) return opts;
  const h = parseInt(v.substring(0, 2), 10);
  const nuit = Number.isFinite(h) && h <= 5;
  const extraLabel =
    nuit && jour
      ? `${labelHeureCourte(v)} · ${labelNuitDuJourASuivant(jour)}`
      : labelHeureCourte(v);
  return [{ value: v, label: extraLabel }, ...opts];
}
