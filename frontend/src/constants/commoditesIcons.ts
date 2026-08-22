import { isLucideName, lucideIcon } from "@/lib/lucideByName";

/** Mapping cle référentiel → nom d’icône Lucide */
export const COMMODITES_ICONS: Record<string, string> = {
  eclairage: "Sun",
  vestiaires: "DoorOpen",
  douches: "Droplets",
  parking: "SquareParking",
  buvette: "UtensilsCrossed",
  tribune: "Rows3",
  wifi: "Wifi",
  arbitre: "Flag",
  ballon: "CircleDot",
  securite: "ShieldCheck",
  toilettes: "Building2",
  pharmacie: "Cross",
  cameraman: "Video",
  livestream: "Radio",
  boutique: "ShoppingBag",
};

export const COMMODITES_ICON_SUGGESTIONS = Array.from(new Set(Object.values(COMMODITES_ICONS)));

export function getCommoditeIconName(cle?: string, icone?: string) {
  if (cle && COMMODITES_ICONS[cle]) return COMMODITES_ICONS[cle];
  if (icone && isLucideName(icone)) return icone;
  return "Star";
}

export function getCommoditeIcon(cle?: string, icone?: string) {
  const fromMap = cle ? COMMODITES_ICONS[cle] : undefined;
  return lucideIcon(icone || fromMap || "Star");
}
