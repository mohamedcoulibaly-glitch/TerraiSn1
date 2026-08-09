/** Catalogue commodités / services — marché sénégalais */
export type CommoditeId =
  | "dossards"
  | "ballon"
  | "eau"
  | "vestiaires"
  | "toilettes"
  | "tribune"
  | "parking"
  | "priere"
  | "buvette"
  | "glacons"
  | "secours"
  | "video";

export type CommoditeDef = {
  id: CommoditeId;
  label: string;
  icon: string;
  group: "inclus" | "infra" | "services";
};

export const COMMODITES_CATALOG: CommoditeDef[] = [
  { id: "dossards", label: "Dossards fournis", icon: "🎽", group: "inclus" },
  { id: "ballon", label: "Ballon fourni", icon: "⚽", group: "inclus" },
  { id: "eau", label: "Eau à la mi-temps", icon: "💧", group: "inclus" },
  { id: "vestiaires", label: "Vestiaires & Douches", icon: "🚿", group: "infra" },
  { id: "toilettes", label: "Toilettes", icon: "🚽", group: "infra" },
  { id: "tribune", label: "Tribune", icon: "🏟️", group: "infra" },
  { id: "parking", label: "Parking gardé", icon: "🅿️", group: "infra" },
  { id: "priere", label: "Espace de prière", icon: "🕌", group: "infra" },
  { id: "buvette", label: "Buvette", icon: "🥤", group: "services" },
  { id: "glacons", label: "Glaçons / Glacière", icon: "🧊", group: "services" },
  { id: "secours", label: "Premiers secours", icon: "🚑", group: "services" },
  { id: "video", label: "Enregistrement vidéo", icon: "🎥", group: "services" },
];

export const COMMODITE_GROUPS: { id: CommoditeDef["group"]; label: string }[] = [
  { id: "inclus", label: "Inclus avec le terrain" },
  { id: "infra", label: "Infrastructures" },
  { id: "services", label: "Services & confort" },
];

const VALID = new Set(COMMODITES_CATALOG.map((c) => c.id));

export function parseCommodites(raw: unknown): CommoditeId[] {
  let list: unknown[] = [];
  if (Array.isArray(raw)) list = raw;
  else if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) list = parsed;
    } catch {
      list = raw.split(",").map((s) => s.trim());
    }
  }
  return list
    .map(String)
    .filter((id): id is CommoditeId => VALID.has(id as CommoditeId));
}

export function resolveCommodites(raw: unknown): CommoditeDef[] {
  const ids = parseCommodites(raw);
  return COMMODITES_CATALOG.filter((c) => ids.includes(c.id));
}

export function formatTerrainType(type?: string | null): string | null {
  const t = String(type || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/vs/g, "v");
  if (t.includes("5v5")) return "5v5";
  if (t.includes("7v7")) return "7v7";
  if (t.includes("11v11")) return "11v11";
  return type ? String(type) : null;
}
