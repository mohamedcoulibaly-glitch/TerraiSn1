/**
 * Labels créneaux — calendrier culturel sénégalais (nuit prolongée).
 * Un créneau mardi 01h00 est perçu comme « Nuit du lundi ».
 * La date technique en DB ne change jamais.
 */

/**
 * Détermine si un créneau est en "nuit prolongée"
 * = entre 00h00 et 04h59 (perçu comme la nuit du jour précédent)
 */
export function estNuitProlongee(heure: string): boolean {
  const h = parseInt(String(heure || "").substring(0, 2), 10);
  return Number.isFinite(h) && h >= 0 && h < 5;
}

/**
 * Retourne le "jour perçu" par le joueur sénégalais.
 * Un créneau mardi 01h00 est perçu comme "nuit du lundi".
 * date et heure sont ceux stockés en DB (date technique réelle).
 */
export function getJourPercu(
  date: string,
  heure: string,
): {
  datePercue: string;
  labelJour: string;
  labelPeriode: string;
  labelComplet: string;
  estNuitProlongee: boolean;
  jourPrecedent: string;
} {
  const h = parseInt(String(heure || "").substring(0, 2), 10);
  const dateObj = new Date(`${String(date).slice(0, 10)}T12:00:00`);

  const JOURS = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];

  const jourTechnique = JOURS[dateObj.getDay()] || "Lundi";

  if (Number.isFinite(h) && h >= 0 && h < 5) {
    const datePercue = new Date(dateObj);
    datePercue.setDate(datePercue.getDate() - 1);
    const jourPrecedentNom = JOURS[datePercue.getDay()] || "Dimanche";
    const y = datePercue.getFullYear();
    const m = String(datePercue.getMonth() + 1).padStart(2, "0");
    const day = String(datePercue.getDate()).padStart(2, "0");
    const datePercueStr = `${y}-${m}-${day}`;

    return {
      datePercue: datePercueStr,
      labelJour: jourPrecedentNom,
      labelPeriode: "nuit prolongée",
      labelComplet: `Nuit du ${jourPrecedentNom} à ${jourTechnique}`,
      estNuitProlongee: true,
      jourPrecedent: jourPrecedentNom,
    };
  }

  let labelPeriode: string;
  if (h >= 5 && h < 12) labelPeriode = "matin";
  else if (h >= 12 && h < 17) labelPeriode = "après-midi";
  else if (h >= 17 && h < 21) labelPeriode = "soir";
  else labelPeriode = "nuit"; // 21h-23h59

  const labelComplet = h >= 21 ? `${jourTechnique} nuit` : `${jourTechnique} ${labelPeriode}`;

  return {
    datePercue: String(date).slice(0, 10),
    labelJour: jourTechnique,
    labelPeriode,
    labelComplet,
    estNuitProlongee: false,
    jourPrecedent: "",
  };
}

/**
 * Formate l'affichage complet d'un créneau pour l'UI
 * Exemples :
 *   "Lundi 18h00 - 19h00"
 *   "Nuit du lundi 01h00 - 02h00 ✦"
 *   "Vendredi soir 22h00 - 23h00"
 */
export function formaterCreneau(
  date: string,
  heure_debut: string,
  heure_fin: string,
  options: { avecDate?: boolean; avecIcone?: boolean } = {},
): string {
  const { avecDate = false, avecIcone = true } = options;
  const { labelComplet, estNuitProlongee: nuit } = getJourPercu(date, heure_debut);
  const icone = nuit && avecIcone ? " ✦" : "";
  const heures = `${String(heure_debut).substring(0, 5)} → ${String(heure_fin).substring(0, 5)}`;

  if (avecDate) {
    return `${labelComplet} · ${heures}${icone}`;
  }
  return `${heures}${icone}`;
}

/**
 * Pour le sélecteur de date côté joueur :
 * Quand le joueur sélectionne "Lundi", il doit voir aussi
 * les créneaux de nuit prolongée (mardi 00h-04h59).
 */
export function getDatesATechniques(datePercue: string): string[] {
  const base = String(datePercue).slice(0, 10);
  const dates = [base];
  const lendemain = new Date(`${base}T12:00:00`);
  lendemain.setDate(lendemain.getDate() + 1);
  const y = lendemain.getFullYear();
  const m = String(lendemain.getMonth() + 1).padStart(2, "0");
  const day = String(lendemain.getDate()).padStart(2, "0");
  dates.push(`${y}-${m}-${day}`);
  return dates;
}

/**
 * Trier les créneaux d'une journée en tenant compte
 * de la nuit prolongée (00h-04h59 vient APRÈS 23h)
 */
export function trierCreneaux<T extends { heure_debut: string }>(creneaux: T[]): T[] {
  return [...creneaux].sort((a, b) => {
    const hA = parseInt(String(a.heure_debut).substring(0, 2), 10);
    const hB = parseInt(String(b.heure_debut).substring(0, 2), 10);
    const ordreA = hA < 5 ? hA + 24 : hA;
    const ordreB = hB < 5 ? hB + 24 : hB;
    return ordreA - ordreB;
  });
}

/**
 * Grouper les créneaux par période pour l'affichage
 */
export function grouperParPeriode<
  T extends {
    heure_debut: string;
    date?: string;
  },
>(creneaux: T[]): Record<string, T[]> {
  const groupes: Record<string, T[]> = {
    "Matin (5h - 12h)": [],
    "Après-midi (12h - 17h)": [],
    "Soir (17h - 21h)": [],
    "Nuit (21h - 00h)": [],
    "Nuit prolongée (00h - 5h)": [],
  };

  for (const c of creneaux) {
    const h = parseInt(String(c.heure_debut).substring(0, 2), 10);
    if (h >= 5 && h < 12) groupes["Matin (5h - 12h)"].push(c);
    else if (h >= 12 && h < 17) groupes["Après-midi (12h - 17h)"].push(c);
    else if (h >= 17 && h < 21) groupes["Soir (17h - 21h)"].push(c);
    else if (h >= 21) groupes["Nuit (21h - 00h)"].push(c);
    else groupes["Nuit prolongée (00h - 5h)"].push(c);
  }

  return Object.fromEntries(Object.entries(groupes).filter(([, v]) => v.length > 0));
}

/** Options d'heure par tranches de 30 min (journée + nuit prolongée). */
export function genererOptionsHeures30min(): {
  journee: string[];
  nuitProlongee: string[];
} {
  const journee: string[] = [];
  for (let h = 5; h <= 23; h += 1) {
    journee.push(`${String(h).padStart(2, "0")}:00`);
    if (h < 23) journee.push(`${String(h).padStart(2, "0")}:30`);
    else journee.push("23:30");
  }
  const nuitProlongee: string[] = [];
  for (let h = 0; h <= 4; h += 1) {
    nuitProlongee.push(`${String(h).padStart(2, "0")}:00`);
    if (h < 4) nuitProlongee.push(`${String(h).padStart(2, "0")}:30`);
    else nuitProlongee.push("04:30");
  }
  return { journee, nuitProlongee };
}

/** Fermeture en nuit prolongée si heure < 05:00 (y compris 00:00 historique = minuit). */
export function estFermetureNuitProlongee(heureFin: string): boolean {
  const raw = String(heureFin || "").slice(0, 5);
  if (raw === "00:00" || raw === "0:00") return true;
  const h = parseInt(raw.substring(0, 2), 10);
  return Number.isFinite(h) && h >= 0 && h < 5;
}

/**
 * Validation horaires : overnight OK si fermeture < 05h ;
 * erreur si fermeture entre 05h et ouverture (même jour incohérent).
 */
export function validerPlageHoraire(
  heureDebut: string,
  heureFin: string,
): { ok: boolean; nuitProlongee: boolean; erreur?: string } {
  const debut = String(heureDebut || "").slice(0, 5);
  const fin = String(heureFin || "").slice(0, 5);
  const hDebut = parseInt(debut.substring(0, 2), 10);
  const hFin = parseInt(fin.substring(0, 2), 10);
  const mDebut = parseInt(debut.substring(3, 5) || "0", 10);
  const mFin = parseInt(fin.substring(3, 5) || "0", 10);
  const startMin = hDebut * 60 + mDebut;
  const endMin = hFin * 60 + mFin;

  if (fin === "00:00" || (hFin >= 0 && hFin < 5)) {
    return { ok: true, nuitProlongee: true };
  }
  if (endMin > startMin) {
    return { ok: true, nuitProlongee: false };
  }
  if (hFin >= 5 && endMin <= startMin) {
    return { ok: false, nuitProlongee: false, erreur: "Heure de fermeture invalide" };
  }
  return { ok: true, nuitProlongee: endMin <= startMin };
}
