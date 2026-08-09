import { useEffect, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight, Heart, MapPin, Star } from "lucide-react";
import { resolveTerrainPhoto, fieldImageForId } from "@/espaces/joueur/components/FieldPhoto";
import { formatTerrainType } from "@/lib/commodites";

interface FieldCardProps {
  terrain: any;
  /** grid | list | carousel — vertical/horizontal = aliases rétrocompat */
  variant?: "horizontal" | "vertical" | "grid" | "list" | "carousel" | "grille" | "liste";
  className?: string;
  onFavoriteChange?: (fav: boolean) => void;
  /** Contexte date pour le libellé dispo : "demain", "ce week-end", "le 12/08" */
  dateLabel?: string | null;
}

type DispoTone = "libre" | "presque" | "complet";

function resolvePhotos(terrain: any): string[] {
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
  if (list.length === 0) list = [resolveTerrainPhoto(terrain)];
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

function dispoInfo(
  terrain: any,
  dateLabel?: string | null
): { label: string; tone: DispoTone; className: string } {
  const inactive =
    terrain.is_active === 0 ||
    terrain.is_active === "0" ||
    terrain.is_active === false;

  if (inactive) {
    return { label: "Indisponible", tone: "complet", className: "bg-red-500/80 text-white" };
  }

  const when = dateLabel ? ` pour ${dateLabel}` : "";
  const hasCount = terrain.creneaux_libres != null && terrain.creneaux_libres !== "";
  const libres = Number(terrain.creneaux_libres);

  if (hasCount && dateLabel) {
    if (terrain.ferme_date) {
      return {
        label: `Fermé${when}`,
        tone: "complet",
        className: "bg-slate-500/80 text-white",
      };
    }
    if (libres <= 0) {
      return {
        label: `Complet${when}`,
        tone: "complet",
        className: "bg-red-500/80 text-white",
      };
    }
    if (libres <= 2) {
      return {
        label: `Derniers créneaux${when}`,
        tone: "presque",
        className: "bg-orange-500/90 text-white",
      };
    }
    return {
      label: `Disponible${when}`,
      tone: "libre",
      className: "bg-emerald-500/90 text-white",
    };
  }

  return {
    label: dateLabel ? `Disponible${when}` : "Disponible",
    tone: "libre",
    className: "bg-emerald-500/90 text-white",
  };
}

const glassOverlayStyle: CSSProperties = {
  background: "rgba(0, 0, 0, 0.4)",
  backdropFilter: "blur(8px)",
  WebkitBackdropFilter: "blur(8px)",
  borderRadius: 20,
  padding: "4px 10px",
};

const FieldCard = ({
  terrain,
  variant = "vertical",
  className = "",
  onFavoriteChange,
  dateLabel = null,
}: FieldCardProps) => {
  const navigate = useNavigate();
  const status = dispoInfo(terrain, dateLabel);
  const go = () => navigate(`/terrain/${terrain.id}`);
  const quartier = terrain.quartier || terrain.adresse || terrain.ville || "";
  const photos = resolvePhotos(terrain);
  const photo = photos[0] || fieldImageForId(terrain.id);
  const prix = Number(terrain.prix_heure ?? terrain.prix_terrain_entier ?? 0);
  const isComplet = status.tone === "complet";
  const formatLabel = formatTerrainType(terrain.type);
  const note = Number(terrain.note || 0);
  const avisCount = Number(terrain.avis_count || 0);
  const isCarousel = variant === "carousel";
  const isList = variant === "horizontal" || variant === "list" || variant === "liste";

  const [fav, setFav] = useState(false);
  useEffect(() => {
    try {
      setFav(localStorage.getItem(favKey(terrain.id)) === "1");
    } catch {
      setFav(false);
    }
  }, [terrain.id]);

  const toggleFav = (e: React.MouseEvent) => {
    e.stopPropagation();
    const next = !fav;
    setFav(next);
    try {
      localStorage.setItem(favKey(terrain.id), next ? "1" : "0");
    } catch {
      /* ignore */
    }
    onFavoriteChange?.(next);
  };

  const ratingRow =
    note > 0 ? (
      <span className="inline-flex items-center gap-0.5 text-[var(--text-primary)] font-semibold shrink-0">
        <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
        {note.toFixed(1)}
        {avisCount > 0 && (
          <span className="font-normal text-[var(--text-muted)]">({avisCount})</span>
        )}
      </span>
    ) : null;

  // VERSION CAROUSEL
  if (isCarousel) {
    return (
      <div
        className={`flex-none w-[230px] md:w-full md:max-w-none terrain-card t-card bg-[var(--card-bg)] border border-[var(--card-border)] rounded-2xl overflow-hidden group active:scale-[0.98] transition-transform cursor-pointer ${className}`}
        onClick={go}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && go()}
      >
        <div className="relative h-[130px] overflow-hidden">
          <img
            src={photo}
            alt={terrain.nom}
            className="w-full h-full object-cover object-center group-hover:scale-105 transition-transform duration-500"
            loading="lazy"
          />
          {terrain.distance_km != null && (
            <span className="absolute text-[11px] font-medium text-white" style={{ ...glassOverlayStyle, top: 12, left: 12 }}>
              {Number(terrain.distance_km).toFixed(1)} km
            </span>
          )}
        </div>
        <div className="p-3">
          <h3 className="font-bold text-[var(--text-primary)] text-sm line-clamp-1">{terrain.nom}</h3>
          <p className="text-[11px] text-[var(--text-muted)] mt-0.5 flex items-center gap-1">
            <MapPin className="w-3 h-3 text-emerald-400 shrink-0" />
            <span className="truncate">{quartier}</span>
            {ratingRow}
          </p>
          <p className={`text-[11px] font-semibold mt-1.5 ${isComplet ? "text-red-400" : "text-emerald-400"}`}>
            {status.label}
          </p>
        </div>
      </div>
    );
  }

  // VERSION LISTE
  if (isList) {
    return (
      <article
        className={`flex overflow-hidden cursor-pointer h-[110px] w-full bg-[var(--card-bg)] border border-[var(--card-border)] rounded-2xl active:scale-[0.98] transition-transform ${className}`}
        onClick={go}
      >
        <div className="relative w-[110px] flex-shrink-0 self-stretch">
          <img src={photo} alt={terrain.nom} className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
        </div>
        <div className="flex flex-col justify-between flex-1 min-w-0 p-3">
          <div>
            <h3 className="font-bold text-[var(--text-primary)] text-sm truncate">{terrain.nom}</h3>
            <p className="text-[11px] text-[var(--text-muted)] truncate mt-0.5 flex items-center gap-1">
              <MapPin className="w-3 h-3 text-emerald-400 shrink-0" />
              {quartier}
            </p>
          </div>
          <span
            className={`inline-flex items-center justify-center gap-1 w-full py-2 rounded-xl text-xs font-bold ${
              isComplet
                ? "bg-[var(--surface-2)] text-[var(--text-muted)] opacity-50"
                : "bg-emerald-500 text-white"
            }`}
          >
            {isComplet ? "Complet" : "Voir le terrain"}
            {!isComplet && <ChevronRight className="w-3.5 h-3.5" />}
          </span>
        </div>
      </article>
    );
  }

  // VERSION pleine largeur (défaut)
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={go}
      onKeyDown={(e) => e.key === "Enter" && go()}
      className={`w-full terrain-card t-card bg-[var(--card-bg)] border border-[var(--card-border)] rounded-2xl overflow-hidden group active:scale-[0.98] transition-transform cursor-pointer ${className}`}
    >
      <div className="relative h-[130px] overflow-hidden">
        <img
          src={photo}
          alt={terrain.nom}
          className="w-full h-full object-cover object-center group-hover:scale-105 transition-transform duration-500"
          loading="lazy"
        />

        {terrain.distance_km != null && (
          <span
            className="absolute text-[11px] font-medium text-white"
            style={{ ...glassOverlayStyle, top: 12, left: 12 }}
          >
            {Number(terrain.distance_km).toFixed(1)} km
          </span>
        )}

        <button
          type="button"
          onClick={toggleFav}
          className="absolute flex items-center justify-center text-white active:text-red-400 transition-colors"
          style={{ ...glassOverlayStyle, top: 12, right: 12, minWidth: 32, minHeight: 28 }}
          aria-label={fav ? "Retirer des favoris" : "Ajouter aux favoris"}
        >
          <Heart className={`w-3.5 h-3.5 ${fav ? "fill-red-400 text-red-400" : ""}`} />
        </button>
      </div>

      <div className="px-3 pt-2.5 pb-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-bold text-[var(--text-primary)] text-[15px] leading-snug min-w-0">
            {terrain.nom}
          </h3>
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 mt-0.5 max-w-[46%] text-right leading-tight ${status.className}`}>
            {status.label}
          </span>
        </div>

        <p className="text-[13px] text-[var(--text-muted)] mt-1 flex items-center gap-1.5 flex-wrap">
          <MapPin className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <span className="line-clamp-1 min-w-0">{quartier}</span>
          {formatLabel && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[var(--surface-2)] text-[var(--text-secondary)] border border-[var(--border)]">
              {formatLabel}
            </span>
          )}
          {ratingRow && <span className="text-[var(--border-strong)]">·</span>}
          {ratingRow}
        </p>

        <div className="mt-2.5 flex items-center justify-between gap-3">
          <p className="text-[var(--primary)] font-black text-sm leading-none shrink-0">
            {prix.toLocaleString("fr-SN")} FCFA
            <span className="font-medium text-[var(--text-muted)] text-xs"> / h</span>
          </p>
          <span
            className={`inline-flex items-center gap-1 px-3.5 py-2 rounded-xl font-bold text-sm min-h-[36px] shrink-0 ${
              isComplet
                ? "bg-[var(--surface-2)] text-[var(--text-muted)] opacity-50"
                : "bg-emerald-500 text-white"
            }`}
          >
            {isComplet ? "Complet" : "Voir le terrain"}
            {!isComplet && <ChevronRight className="w-4 h-4" />}
          </span>
        </div>
      </div>
    </div>
  );
};

export default FieldCard;
export { FieldCard as TerrainCard };
