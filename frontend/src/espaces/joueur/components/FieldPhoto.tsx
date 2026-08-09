import field1 from "@/assets/field-1.jpg";
import field2 from "@/assets/field-2.jpg";
import field3 from "@/assets/field-3.jpg";
import field4 from "@/assets/field-4.jpg";

const FIELD_IMAGES = [field1, field2, field3, field4];

export function fieldImageForId(id?: number | string) {
  const n = Number(id) || 1;
  return FIELD_IMAGES[(Math.max(1, n) - 1) % FIELD_IMAGES.length];
}

export function resolveTerrainPhoto(terrain: { id?: number | string; photos?: unknown }) {
  const list = resolveTerrainPhotos(terrain);
  return list[0] || fieldImageForId(terrain?.id);
}

export function resolveTerrainPhotos(terrain: { id?: number | string; photos?: unknown }): string[] {
  const raw = terrain?.photos;
  let list: string[] = [];
  if (Array.isArray(raw)) list = raw.map(String).filter(Boolean);
  else if (typeof raw === "string" && raw.trim()) {
    if (raw.startsWith("[")) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) list = parsed.map(String).filter(Boolean);
      } catch {
        /* ignore */
      }
    } else if (raw.startsWith("http") || raw.startsWith("/")) {
      list = [raw];
    }
  }
  if (list.length === 0) list = [fieldImageForId(terrain?.id)];
  // Varier le carrousel si une seule photo (démo visuelle)
  if (list.length === 1) {
    const base = Number(terrain?.id) || 1;
    list = [
      list[0],
      fieldImageForId(base + 1),
      fieldImageForId(base + 2),
    ];
  }
  return list;
}

type FieldPhotoProps = {
  id?: number | string;
  alt: string;
  className?: string;
  heightClass?: string;
  src?: string | null;
};

/** Photo terrain : URL fournie, sinon photo par défaut selon l’id. */
export default function FieldPhoto({
  id = 1,
  alt,
  className = "",
  heightClass = "h-[180px]",
  src,
}: FieldPhotoProps) {
  const photo = src || fieldImageForId(id);

  return (
    <div className={`relative w-full overflow-hidden bg-[var(--color-surface-2)] ${heightClass} ${className}`}>
      <img
        src={photo}
        alt={alt}
        className="absolute inset-0 w-full h-full object-cover"
        loading="lazy"
        decoding="async"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/25 via-transparent to-transparent pointer-events-none" />
    </div>
  );
}
