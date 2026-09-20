/** Noms Lucide des commodités (catalogue + suggestions du formulaire superadmin). */

const ICONS_BY_CLE: Record<string, string> = {
  eclairage: "Zap",
  vestiaires: "Users",
  douches: "Droplets",
  parking: "Car",
  buvette: "Coffee",
  tribune: "Armchair",
  wifi: "Wifi",
  arbitre: "Flag",
  ballon: "CircleDot",
  securite: "Shield",
  dossards: "Shirt",
  eau: "Droplet",
  toilettes: "Bath",
  priere: "Moon",
  glacons: "Snowflake",
  secours: "Ambulance",
  video: "Video",
};

export const COMMODITES_ICON_SUGGESTIONS = [
  "Zap",
  "Users",
  "Droplets",
  "Car",
  "Coffee",
  "Armchair",
  "Wifi",
  "Flag",
  "CircleDot",
  "Shield",
  "Shirt",
  "Droplet",
  "Bath",
  "Moon",
  "Snowflake",
  "Ambulance",
  "Video",
  "Star",
  "SquareParking",
];

export function getCommoditeIconName(cle?: string, icone?: string) {
  const fromIcon = String(icone || "").trim();
  if (fromIcon) return fromIcon;
  const key = String(cle || "").trim().toLowerCase();
  return ICONS_BY_CLE[key] || "Star";
}
