import { useState } from "react";
import { getImageSources } from "@/lib/imageOptimizer";

const FALLBACK_IMAGES = [
  "/fields/field-1.jpg",
  "/fields/field-2.jpg",
  "/fields/field-3.jpg",
  "/fields/field-4.jpg",
];

const PLACEHOLDER = "/images/terrain-placeholder.jpg";

export function fieldImageForId(id?: number | string) {
  const n = Number(id) || 1;
  return FALLBACK_IMAGES[(Math.max(1, n) - 1) % FALLBACK_IMAGES.length];
}

export function resolveTerrainPhoto(terrain: {
  id?: number | string;
  photos?: unknown;
  terrain_photos?: Array<{ url?: string; est_principale?: number | boolean }>;
}) {
  const list = resolveTerrainPhotos(terrain);
  return list[0] || PLACEHOLDER;
}

export function resolveTerrainPhotos(terrain: {
  id?: number | string;
  photos?: unknown;
  terrain_photos?: Array<{ url?: string; est_principale?: number | boolean; ordre?: number }>;
}): string[] {
  const rows = Array.isArray(terrain?.terrain_photos) ? [...terrain.terrain_photos] : [];
  if (rows.length) {
    rows.sort((a, b) => Number(a.ordre || 0) - Number(b.ordre || 0));
    return rows.map((p) => String(p.url || "")).filter(Boolean);
  }
  const raw = terrain?.photos;
  let list: string[] = [];
  if (Array.isArray(raw)) list = raw.map((item) => (typeof item === "string" ? item : String((item as { url?: string })?.url || ""))).filter(Boolean);
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
  if (list.length === 0) return [PLACEHOLDER];
  return list;
}

export function resolvePhotoPrincipale(terrain: {
  id?: number | string;
  photos?: unknown;
  terrain_photos?: Array<{ url?: string; est_principale?: number | boolean }>;
}) {
  const rows = Array.isArray(terrain?.terrain_photos) ? terrain.terrain_photos : [];
  const principale = rows.find((p) => Boolean(p.est_principale));
  if (principale?.url) return principale.url;
  return resolveTerrainPhotos(terrain)[0] || PLACEHOLDER;
}

type FieldPhotoProps = {
  id?: number | string;
  alt: string;
  className?: string;
  heightClass?: string;
  src?: string | null;
};

/** Photo terrain optimisée WebP/AVIF avec lazy loading. */
export default function FieldPhoto({
  id = 1,
  alt,
  className = "",
  heightClass = "h-[180px]",
  src,
}: FieldPhotoProps) {
  const photo = src || fieldImageForId(id);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const displaySrc = error ? fieldImageForId(id) : photo;
  const sources = getImageSources(displaySrc, 640);
  const isRemote = displaySrc.startsWith("http");

  return (
    <div className={`relative w-full overflow-hidden bg-[var(--color-surface-2)] ${heightClass} ${className}`}>
      {!loaded && (
        <div className="absolute inset-0 animate-pulse bg-[var(--color-surface-2)]" aria-hidden />
      )}
      {isRemote && sources.webp ? (
        <picture>
          {sources.avif && <source srcSet={sources.avif} type="image/avif" />}
          <source srcSet={sources.webp} type="image/webp" />
          <img
            src={sources.fallback}
            alt={alt}
            className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`}
            loading="lazy"
            decoding="async"
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            onLoad={() => setLoaded(true)}
            onError={() => {
              setError(true);
              setLoaded(true);
            }}
          />
        </picture>
      ) : (
        <img
          src={displaySrc}
          alt={alt}
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => {
            setError(true);
            setLoaded(true);
          }}
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/25 via-transparent to-transparent pointer-events-none" />
    </div>
  );
}
