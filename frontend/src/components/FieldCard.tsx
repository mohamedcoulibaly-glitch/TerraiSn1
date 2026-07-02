import { MapPin, Star, Users } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface FieldCardProps {
  terrain: any;
  variant?: "horizontal" | "vertical";
  className?: string;
}

// Images par défaut basées sur l'id du terrain
const defaultImages = [
  '/src/assets/field-1.jpg',
  '/src/assets/field-2.jpg',
  '/src/assets/field-3.jpg',
  '/src/assets/field-4.jpg',
];

const FieldCard = ({ terrain, variant = "vertical", className = "" }: FieldCardProps) => {
  const navigate = useNavigate();
  const photo = defaultImages[(terrain.id - 1) % defaultImages.length];
  const note = terrain.note || 0;
  const avisCount = terrain.avis_count || terrain.avis || 0;
  const disponible = terrain.is_active === 1 || terrain.is_active === "1" || terrain.is_active === true || terrain.disponible === true || terrain.is_active === undefined;

  if (variant === "horizontal") {
    return (
      <div
        className={`field-card relative flex gap-3 p-3 cursor-pointer active:scale-[0.98] transition-transform ${className}`}
        onClick={() => navigate(`/terrain/${terrain.id}`)}
      >
        <img
          src={photo}
          alt={terrain.nom}
          className="w-24 h-24 sm:w-28 sm:h-28 rounded-xl object-cover flex-shrink-0"
          loading="lazy"
          width={96}
          height={96}
        />
        <div className="flex flex-col justify-between flex-1 min-w-0">
          <div>
            <h3 className="font-display font-semibold text-sm sm:text-base truncate">{terrain.nom}</h3>
            <div className="flex items-center gap-1 text-muted-foreground text-xs mt-0.5">
              <MapPin className="w-3 h-3 flex-shrink-0" />
              <span className="truncate">{terrain.adresse}, {terrain.ville}</span>
            </div>
            <div className="flex items-center gap-1 text-muted-foreground text-xs mt-0.5">
              <Users className="w-3 h-3 flex-shrink-0" />
              <span>{terrain.type}</span>
            </div>
          </div>
          <div className="flex items-center justify-between mt-1">
            <div className="flex items-center gap-1">
              <Star className="w-3 h-3 fill-secondary text-secondary" />
              <span className="text-xs font-medium">{note}</span>
              <span className="text-[10px] text-muted-foreground">({avisCount})</span>
            </div>
            <span className="price-tag text-sm">{terrain.prix_heure.toLocaleString()} CFA/h</span>
          </div>
        </div>
        {!disponible && (
          <div className="absolute inset-0 bg-card/60 rounded-2xl flex items-center justify-center pointer-events-none">
            <span className="bg-destructive text-destructive-foreground text-xs font-medium px-3 py-1 rounded-full">Indisponible</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={`field-card cursor-pointer w-44 sm:w-full flex-shrink-0 active:scale-[0.98] transition-transform relative ${className}`}
      onClick={() => navigate(`/terrain/${terrain.id}`)}
    >
      <div className="relative">
        <img
          src={photo}
          alt={terrain.nom}
          className="w-full h-28 sm:h-36 object-cover"
          loading="lazy"
          width={176}
          height={112}
        />
        <div className="absolute top-2 right-2 flex items-center gap-1 bg-card/90 backdrop-blur-sm rounded-full px-2 py-0.5">
          <Star className="w-3 h-3 fill-secondary text-secondary" />
          <span className="text-xs font-medium">{note}</span>
        </div>
        {!disponible && (
          <div className="absolute inset-0 bg-card/60 flex items-center justify-center">
            <span className="bg-destructive text-destructive-foreground text-[10px] font-medium px-2 py-0.5 rounded-full">Indisponible</span>
          </div>
        )}
      </div>
      <div className="p-3">
        <h3 className="font-display font-semibold text-xs sm:text-sm truncate">{terrain.nom}</h3>
        <p className="text-muted-foreground text-[10px] sm:text-xs mt-0.5 flex items-center gap-1">
          <Users className="w-3 h-3" /> {terrain.type}
        </p>
        <div className="flex items-center justify-between mt-1.5">
          <span className="text-muted-foreground text-[11px] sm:text-xs">{terrain.ville}</span>
          <span className="price-tag text-xs">{terrain.prix_heure.toLocaleString()} CFA</span>
        </div>
      </div>
    </div>
  );
};

export default FieldCard;
