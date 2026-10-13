/** Catalogue commodités / services — fallback + normalisation API DB */

export type CommoditeId = string;

export type CommoditeDef = {
  id: CommoditeId;
  label: string;
  icon: string;
  group?: "inclus" | "infra" | "services" | "autre";
};

/** Fallback local si le catalogue API n'est pas encore chargé. */
export const COMMODITES_CATALOG: CommoditeDef[] = [
  { id: "dossards", label: "Dossards fournis", icon: "Shirt", group: "inclus" },
  { id: "ballon", label: "Ballon fourni", icon: "CircleDot", group: "inclus" },
  { id: "eau", label: "Eau à la mi-temps", icon: "Droplet", group: "inclus" },
  { id: "vestiaires", label: "Vestiaires & Douches", icon: "Shirt", group: "infra" },
  { id: "toilettes", label: "Toilettes", icon: "Bath", group: "infra" },
  { id: "tribune", label: "Tribune", icon: "Users", group: "infra" },
  { id: "parking", label: "Parking gardé", icon: "SquareParking", group: "infra" },
  { id: "priere", label: "Espace de prière", icon: "Building2", group: "infra" },
  { id: "buvette", label: "Buvette", icon: "Utensils", group: "services" },
  { id: "glacons", label: "Glaçons / Glacière", icon: "Snowflake", group: "services" },
  { id: "secours", label: "Premiers secours", icon: "Cross", group: "services" },
  { id: "video", label: "Enregistrement vidéo", icon: "Video", group: "services" },
];

export const COMMODITE_GROUPS: { id: NonNullable<CommoditeDef["group"]>; label: string }[] = [
  { id: "inclus", label: "Inclus avec le terrain" },
  { id: "infra", label: "Infrastructures" },
  { id: "services", label: "Services & confort" },
  { id: "autre", label: "Autres" },
];

const CLE_RE = /^[a-z][a-z0-9_]*$/;

/** Accepte toute clé snake_case (catalogue DB dynamique), pas seulement le fallback TS. */
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
    .map((item) => {
      if (item && typeof item === "object" && "cle" in (item as object)) {
        return String((item as { cle?: string }).cle || "").trim();
      }
      return String(item || "").trim();
    })
    .filter((id) => Boolean(id) && CLE_RE.test(id));
}

export function resolveCommodites(raw: unknown, catalog: CommoditeDef[] = COMMODITES_CATALOG): CommoditeDef[] {
  const ids = parseCommodites(raw);
  return ids.map((id) => {
    const def = catalog.find((c) => c.id === id);
    return def || { id, label: id, icon: "CheckCircle2", group: "autre" as const };
  });
}

export type PublicCommodite = { cle: string; label_fr: string; icone: string };

function iconForCle(cle: string, catalog: CommoditeDef[] = COMMODITES_CATALOG) {
  const def = catalog.find((c) => c.id === cle);
  return def?.icon || "CheckCircle2";
}

export function normalizePublicCommodites(
  raw: unknown,
  catalog: CommoditeDef[] = COMMODITES_CATALOG,
): PublicCommodite[] {
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
        const cle = String(row.cle || "");
        return {
          cle,
          label_fr: String(row.label_fr || row.label || cle || ""),
          icone: String(row.icone || iconForCle(cle, catalog)),
        };
      }
      const id = String(item || "");
      const def = catalog.find((c) => c.id === id);
      if (!id) return null;
      return { cle: id, label_fr: def?.label || id, icone: def?.icon || "CheckCircle2" };
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

export function catalogFromApiRows(
  rows: Array<{ cle?: string; label_fr?: string; icone?: string }>,
): CommoditeDef[] {
  return (rows || [])
    .map((r) => ({
      id: String(r.cle || ""),
      label: String(r.label_fr || r.cle || ""),
      icon: String(r.icone || "CheckCircle2"),
      group: "autre" as const,
    }))
    .filter((c) => c.id);
}
