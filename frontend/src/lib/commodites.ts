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
  { id: "dossards", label: "Dossards fournis", icon: "Shirt", group: "inclus" },
  { id: "ballon", label: "Ballon fourni", icon: "CircleDot", group: "inclus" },
  { id: "eau", label: "Eau à la mi-temps", icon: "Droplets", group: "inclus" },
  { id: "vestiaires", label: "Vestiaires & Douches", icon: "DoorOpen", group: "infra" },
  { id: "toilettes", label: "Toilettes", icon: "Building2", group: "infra" },
  { id: "tribune", label: "Tribune", icon: "Rows3", group: "infra" },
  { id: "parking", label: "Parking gardé", icon: "SquareParking", group: "infra" },
  { id: "priere", label: "Espace de prière", icon: "Moon", group: "infra" },
  { id: "buvette", label: "Buvette", icon: "UtensilsCrossed", group: "services" },
  { id: "glacons", label: "Glaçons / Glacière", icon: "Snowflake", group: "services" },
  { id: "secours", label: "Premiers secours", icon: "Cross", group: "services" },
  { id: "video", label: "Enregistrement vidéo", icon: "Video", group: "services" },
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

export type PublicCommodite = { cle: string; label_fr: string; icone: string };

export function normalizePublicCommodites(raw: unknown): PublicCommodite[] {
  let list: unknown[] = [];
  if (Array.isArray(raw)) list = raw;
  else if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) list = parsed;
    } catch {
      list = [];
    }
  }
  return list
    .map((item) => {
      if (item && typeof item === "object" && "cle" in (item as object)) {
        const row = item as { cle?: string; label_fr?: string; icone?: string; label?: string };
        return {
          cle: String(row.cle || ""),
          label_fr: String(row.label_fr || row.label || row.cle || ""),
          icone: String(row.icone || "Star"),
        };
      }
      const id = String(item || "");
      const def = COMMODITES_CATALOG.find((c) => c.id === id);
      if (!id) return null;
      return { cle: id, label_fr: def?.label || id, icone: "Star" };
    })
    .filter((x): x is PublicCommodite => Boolean(x?.cle));
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
