import { useNavigate } from "react-router-dom";
import FieldPhoto, { resolveTerrainPhoto } from "@/espaces/joueur/components/FieldPhoto";

interface FieldCardProps {
  terrain: any;
  variant?: "horizontal" | "vertical";
  className?: string;
}

function statusInfo(terrain: any) {
  const disponible =
    terrain.is_active === 1 ||
    terrain.is_active === "1" ||
    terrain.is_active === true ||
    terrain.disponible === true ||
    terrain.is_active === undefined;

  if (!disponible) {
    return {
      label: "Complet",
      className: "bg-[var(--color-danger)] text-white",
    };
  }

  const note = Number(terrain.note || 0);
  if (note >= 4.5) {
    return {
      label: "Presque complet",
      className: "bg-[var(--color-warning)] text-white",
    };
  }

  return {
    label: "Libre",
    className: "bg-[var(--color-success)] text-white",
  };
}

const FieldCard = ({ terrain, variant = "vertical", className = "" }: FieldCardProps) => {
  const navigate = useNavigate();
  const status = statusInfo(terrain);
  const go = () => navigate(`/terrain/${terrain.id}`);
  const quartier = terrain.quartier || terrain.adresse || terrain.ville || "";
  const photo = resolveTerrainPhoto(terrain);

  if (variant === "horizontal") {
    return (
      <article
        className={`field-card flex gap-0 overflow-hidden cursor-pointer ${className}`}
        onClick={go}
      >
        <div className="w-28 sm:w-36 flex-shrink-0 self-stretch">
          <FieldPhoto id={terrain.id} alt={terrain.nom} src={photo} heightClass="h-full min-h-[112px]" />
        </div>
        <div className="flex flex-col justify-between flex-1 min-w-0 p-4 gap-2">
          <div>
            <div className="flex items-start justify-between gap-2 mb-1">
              <h3
                className="text-base font-semibold truncate text-[var(--color-text-primary)]"
                style={{ fontFamily: "var(--font-display)" }}
              >
                {terrain.nom}
              </h3>
              <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${status.className}`}>
                {status.label}
              </span>
            </div>
            <p className="text-[13px] text-[var(--color-text-muted)] truncate">{quartier}</p>
          </div>
          <p className="text-sm font-semibold text-[var(--color-primary)]">
            {Number(terrain.prix_heure || 0).toLocaleString()} CFA/h
          </p>
        </div>
      </article>
    );
  }

  return (
    <article
      className={`field-card w-full max-w-full flex-shrink-0 overflow-hidden ${className}`}
    >
      <div className="relative cursor-pointer" onClick={go}>
        <FieldPhoto
          id={terrain.id}
          alt={terrain.nom}
          src={photo}
          heightClass="h-[180px]"
          className="rounded-t-[var(--radius-lg)]"
        />
        <span
          className={`absolute top-3 right-3 text-[11px] font-medium px-2.5 py-1 rounded-full shadow-sm ${status.className}`}
        >
          {status.label}
        </span>
      </div>
      <div className="p-4">
        <h3
          className="text-base font-semibold truncate text-[var(--color-text-primary)] cursor-pointer"
          style={{ fontFamily: "var(--font-display)" }}
          onClick={go}
        >
          {terrain.nom}
        </h3>
        <p className="text-[13px] text-[var(--color-text-muted)] mt-1 truncate">{quartier}</p>
        <p className="mt-2 text-sm font-semibold text-[var(--color-primary)]">
          {Number(terrain.prix_heure || 0).toLocaleString()} CFA/h
        </p>
        <button
          type="button"
          onClick={go}
          className="mt-3 w-full h-12 rounded-[var(--radius-md)] bg-[var(--color-primary)] text-white text-sm font-medium hover:bg-[var(--color-primary-light)]"
        >
          Réserver
        </button>
      </div>
    </article>
  );
};

export default FieldCard;
