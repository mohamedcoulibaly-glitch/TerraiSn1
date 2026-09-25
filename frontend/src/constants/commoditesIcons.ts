import { isLucideName, lucideIcon } from "@/lib/lucideByName";

/** Icônes génériques / placeholder à ignorer au profit du mapping par clé */
const GENERIC_ICONS = new Set(["Star", "star", "Sparkle"]);

/**
 * Mapping cle référentiel → nom d’icône Lucide.
 * Prioritaire sur la colonne `icone` en base (souvent encore "Star").
 */
export const COMMODITES_ICONS: Record<string, string> = {
  // Confort & Services
  vestiaires: "Shirt",
  douches: "ShowerHead",
  parking: "SquareParking",
  wifi: "Wifi",
  toilettes: "Bath",
  priere: "Building2",
  espace_priere: "Building2",

  // Jeu & Matériel
  eclairage: "Lightbulb",
  eclairage_nocturne: "Lightbulb",
  arbitre: "Award", // Whistle indisponible dans lucide-react
  ballon: "CircleDot",
  dossards: "Shirt",

  // Restauration & Sécurité
  buvette: "Utensils",
  securite: "ShieldCheck",
  eau: "Droplet",
  glacons: "Snowflake",
  glaciere: "Snowflake",
  secours: "Cross",
  pharmacie: "Cross",
  premiers_secours: "Cross",

  // Autres
  tribune: "Users",
  video: "Video",
  cameraman: "Video",
  livestream: "Video",
  boutique: "ShoppingBag",
};

export const COMMODITES_ICON_SUGGESTIONS = Array.from(new Set(Object.values(COMMODITES_ICONS)));

const FALLBACK_ICON = "CheckCircle2";

function normalizeCle(cle?: string) {
  return String(cle || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

export function getCommoditeIconName(cle?: string, icone?: string) {
  const key = normalizeCle(cle);
  if (key && COMMODITES_ICONS[key]) return COMMODITES_ICONS[key];
  if (icone && !GENERIC_ICONS.has(icone) && isLucideName(icone)) return icone;
  return FALLBACK_ICON;
}

export function getCommoditeIcon(cle?: string, icone?: string) {
  return lucideIcon(getCommoditeIconName(cle, icone));
}
