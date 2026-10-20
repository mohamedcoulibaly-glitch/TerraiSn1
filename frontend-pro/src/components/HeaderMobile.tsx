import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { BoutonRetour } from "./BoutonRetour";
import { useSwipeBack } from "@/hooks/useSwipeBack";

type HeaderMobileProps = {
  titre: string;
  soustitre?: string;
  onRetour?: () => void;
  action?: ReactNode;
};

/**
 * Header standard des pages secondaires mobiles :
 * bouton retour 44px, titre centré, action optionnelle à droite,
 * swipe depuis le bord gauche pour revenir, safe-area iOS en haut.
 */
export const HeaderMobile = ({ titre, soustitre, onRetour, action }: HeaderMobileProps) => {
  const navigate = useNavigate();
  useSwipeBack(() => (onRetour ? onRetour() : navigate(-1)));

  return (
    <header
      className="sticky top-0 z-40 flex items-center justify-between px-4"
      style={{
        minHeight: "56px",
        background: "var(--surface)",
        borderBottom: "1px solid var(--color-border)",
        paddingTop: "env(safe-area-inset-top)",
      }}
    >
      <BoutonRetour onRetour={onRetour} />

      <div className="flex-1 text-center min-w-0 px-2">
        <h1 className="font-semibold text-sm truncate" style={{ color: "var(--color-text-primary)" }}>
          {titre}
        </h1>
        {soustitre && (
          <p className="text-xs truncate" style={{ color: "var(--color-text-muted)" }}>
            {soustitre}
          </p>
        )}
      </div>

      <div className="w-10 flex justify-end shrink-0">{action}</div>
    </header>
  );
};

export default HeaderMobile;
