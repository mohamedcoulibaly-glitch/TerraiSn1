import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight, Heart, MapPin, Star } from "lucide-react";
import { resolveTerrainPhoto, fieldImageForId } from "@/espaces/joueur/components/FieldPhoto";
import { Badge, type BadgeTone } from "@/espaces/joueur/components/Badge";
import { formatTerrainType } from "@/lib/commodites";
import { cn, formatFcfaPerHour } from "@/lib/utils";

export type PitchCardVariant =
  | "horizontal"
  | "vertical"
  | "grid"
  | "list"
  | "carousel"
  | "grille"
  | "liste";

export type PitchCardProps = {
  pitch?: any;
  /** Alias rétrocompat */
  terrain?: any;
  variant?: PitchCardVariant;
  className?: string;
  onFavoriteChange?: (fav: boolean) => void;
  dateLabel?: string | null;
};

type DispoTone = Exclude<BadgeTone, "neutral">;

function resolvePhotos(pitch: any): string[] {
  const raw = pitch?.photos;
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
  if (list.length === 0) list = [resolveTerrainPhoto(pitch)];
  return list;
}

export function favKey(id: number | string) {
  return `terrainsn_fav_${id}`;
}

export function isTerrainFavorite(id: number | string): boolean {
  try {
    return localStorage.getItem(favKey(id)) === "1";
  } catch {
    return false;
  }
}

function dispoInfo(pitch: any): { label: string; tone: DispoTone } {
  const inactive =
    pitch.is_active === 0 || pitch.is_active === "0" || pitch.is_active === false;

  if (inactive) return { label: "Indisponible", tone: "complet" };

  const hasCount = pitch.creneaux_libres != null && pitch.creneaux_libres !== "";
  const libres = Number(pitch.creneaux_libres);

  if (hasCount) {
    if (pitch.ferme_date) return { label: "Fermé", tone: "complet" };
    if (libres <= 0) return { label: "Complet", tone: "complet" };
    if (libres <= 2) return { label: "Derniers créneaux", tone: "presque" };
    return { label: "Disponible", tone: "libre" };
  }

  return { label: "Disponible", tone: "libre" };
}

function FavoriteButton({
  fav,
  onToggle,
}: {
  fav: boolean;
  onToggle: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-black/40 text-white backdrop-blur-md transition-colors active:text-red-400"
      aria-label={fav ? "Retirer des favoris" : "Ajouter aux favoris"}
    >
      <Heart className={cn("h-3.5 w-3.5", fav && "fill-red-400 text-red-400")} />
    </button>
  );
}

function OverlayBadges({
  distanceKm,
  status,
  fav,
  onToggleFav,
  showFavorite = true,
}: {
  distanceKm: number | null;
  status: { label: string; tone: DispoTone };
  fav?: boolean;
  onToggleFav?: (e: React.MouseEvent) => void;
  showFavorite?: boolean;
}) {
  return (
    <>
      {distanceKm != null && Number.isFinite(distanceKm) && (
        <div className="absolute left-3 top-3 z-10">
          <Badge>{distanceKm.toFixed(1)} km</Badge>
        </div>
      )}
      <div className="absolute right-3 top-3 z-10 flex items-center gap-1.5">
        <Badge tone={status.tone} withDot>
          {status.label}
        </Badge>
        {showFavorite && onToggleFav != null && fav != null && (
          <FavoriteButton fav={fav} onToggle={onToggleFav} />
        )}
      </div>
    </>
  );
}

function MetaRow({
  quartier,
  formatLabel,
  note,
  avisCount,
}: {
  quartier: string;
  formatLabel: string | null;
  note: number;
  avisCount: number;
}) {
  const parts = [quartier, formatLabel].filter(Boolean);
  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[13px] leading-snug text-neutral-400 sm:text-sm">
      <MapPin className="h-3.5 w-3.5 shrink-0 text-emerald-500" aria-hidden />
      <span className="min-w-0 line-clamp-1">{parts.join(" · ")}</span>
      {note > 0 && (
        <span className="inline-flex shrink-0 items-center gap-0.5 text-[13px] text-neutral-400">
          <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" aria-hidden />
          <span className="tabular-nums">{note.toFixed(1)}</span>
          {avisCount > 0 && <span>({avisCount})</span>}
        </span>
      )}
    </p>
  );
}

function PriceRow({ prix, isComplet, pitchName }: { prix: number; isComplet: boolean; pitchName: string }) {
  return (
    <div className="mt-2.5 flex items-center justify-between gap-3">
      <p className="min-w-0 text-base font-bold tabular-nums leading-none text-[var(--text-primary)]">
        {formatFcfaPerHour(prix)}
      </p>
      <span
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors duration-200",
          isComplet
            ? "bg-neutral-200 text-neutral-400 dark:bg-neutral-700"
            : "bg-emerald-500 text-white group-hover:bg-emerald-600"
        )}
        aria-hidden
      >
        <ChevronRight className="h-4 w-4" strokeWidth={2.5} />
      </span>
      <span className="sr-only">{isComplet ? `${pitchName}, complet` : `Voir le terrain ${pitchName}`}</span>
    </div>
  );
}

export function PitchCard({
  pitch,
  terrain,
  variant = "vertical",
  className = "",
  onFavoriteChange,
}: PitchCardProps) {
  const data = pitch ?? terrain;
  const navigate = useNavigate();
  const status = dispoInfo(data);
  const go = () => navigate(`/terrain/${data.id}`);
  const quartier = data.quartier || data.adresse || data.ville || "";
  const photos = resolvePhotos(data);
  const photo = photos[0] || fieldImageForId(data.id);
  const prix = Number(data.prix_heure ?? data.prix_terrain_entier ?? 0);
  const isComplet = status.tone === "complet";
  const formatLabel = formatTerrainType(data.type);
  const note = Number(data.note || 0);
  const avisCount = Number(data.avis_count || 0);
  const isCarousel = variant === "carousel";
  const isList = variant === "horizontal" || variant === "list" || variant === "liste";
  const distanceKm = data.distance_km != null ? Number(data.distance_km) : null;
  const cardLabel = `Voir le terrain ${data.nom}`;

  const [fav, setFav] = useState(false);
  useEffect(() => {
    try {
      setFav(localStorage.getItem(favKey(data.id)) === "1");
    } catch {
      setFav(false);
    }
  }, [data.id]);

  const toggleFav = (e: React.MouseEvent) => {
    e.stopPropagation();
    const next = !fav;
    setFav(next);
    try {
      localStorage.setItem(favKey(data.id), next ? "1" : "0");
    } catch {
      /* ignore */
    }
    onFavoriteChange?.(next);
  };

  const openKeys = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      go();
    }
  };

  if (isCarousel) {
    return (
      <div
        className={cn(
          "terrain-card t-card group w-[230px] flex-none cursor-pointer overflow-hidden rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] transition-transform active:scale-[0.98] md:w-full md:max-w-none",
          className
        )}
        onClick={go}
        onKeyDown={openKeys}
        role="button"
        tabIndex={0}
        aria-label={cardLabel}
      >
        <div className="relative h-[130px] overflow-hidden">
          <img
            src={photo}
            alt=""
            className="h-full w-full object-cover object-center transition-transform duration-500 group-hover:scale-105"
            loading="lazy"
          />
          <OverlayBadges distanceKm={distanceKm} status={status} showFavorite={false} />
        </div>
        <div className="p-3">
          <h3 className="line-clamp-1 text-sm font-bold text-[var(--text-primary)]">{data.nom}</h3>
          <MetaRow quartier={quartier} formatLabel={formatLabel} note={note} avisCount={avisCount} />
          <PriceRow prix={prix} isComplet={isComplet} pitchName={data.nom} />
        </div>
      </div>
    );
  }

  if (isList) {
    return (
      <article
        className={cn(
          "group flex h-[110px] w-full cursor-pointer overflow-hidden rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] transition-transform active:scale-[0.98]",
          className
        )}
        onClick={go}
        onKeyDown={openKeys}
        role="button"
        tabIndex={0}
        aria-label={cardLabel}
      >
        <div className="relative w-[110px] flex-shrink-0 self-stretch">
          <img src={photo} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
          <OverlayBadges distanceKm={null} status={status} showFavorite={false} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col justify-between p-3">
          <div>
            <h3 className="truncate text-sm font-bold text-[var(--text-primary)]">{data.nom}</h3>
            <MetaRow quartier={quartier} formatLabel={formatLabel} note={note} avisCount={avisCount} />
          </div>
          <PriceRow prix={prix} isComplet={isComplet} pitchName={data.nom} />
        </div>
      </article>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={go}
      onKeyDown={openKeys}
      aria-label={cardLabel}
      className={cn(
        "terrain-card t-card group w-full cursor-pointer overflow-hidden rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] transition-transform active:scale-[0.98]",
        className
      )}
    >
      <div className="relative h-[130px] overflow-hidden">
        <img
          src={photo}
          alt=""
          className="h-full w-full object-cover object-center transition-transform duration-500 group-hover:scale-105"
          loading="lazy"
        />
        <OverlayBadges
          distanceKm={distanceKm}
          status={status}
          fav={fav}
          onToggleFav={toggleFav}
        />
      </div>

      <div className="px-3 pb-3 pt-2.5">
        <h3 className="text-[15px] font-bold leading-snug text-[var(--text-primary)]">{data.nom}</h3>
        <MetaRow quartier={quartier} formatLabel={formatLabel} note={note} avisCount={avisCount} />
        <PriceRow prix={prix} isComplet={isComplet} pitchName={data.nom} />
      </div>
    </div>
  );
}

export default PitchCard;
