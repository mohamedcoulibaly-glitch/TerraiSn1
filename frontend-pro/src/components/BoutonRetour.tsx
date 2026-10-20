import { ChevronLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";

type BoutonRetourProps = {
  label?: string;
  onRetour?: () => void;
  className?: string;
};

/**
 * Bouton retour standard des pages secondaires.
 * Touch target minimum 44×44px (règle mobile TerrainSN).
 */
export const BoutonRetour = ({ label = "", onRetour, className = "" }: BoutonRetourProps) => {
  const navigate = useNavigate();

  const handleRetour = () => {
    if (onRetour) {
      onRetour();
    } else if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate("/");
    }
  };

  return (
    <button
      type="button"
      onClick={handleRetour}
      className={`flex items-center gap-1 py-2 pr-3 -ml-1 btn-press ${className}`}
      style={{ color: "var(--color-primary)", minWidth: "44px", minHeight: "44px" }}
      aria-label="Retour"
    >
      <ChevronLeft className="w-5 h-5" />
      {label && <span className="text-sm font-medium">{label}</span>}
    </button>
  );
};

export default BoutonRetour;
