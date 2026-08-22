import { Outlet } from "react-router-dom";
import BottomNav from "@/espaces/joueur/components/BottomNav";
import DesktopNavbar from "@/espaces/joueur/components/DesktopNavbar";

/**
 * Layout espace joueur — même chrome que propriétaire / gérant :
 * - Mobile : barre du bas
 * - Tablette+ (≥ md) : navbar fixe, barre du bas masquée
 */
export default function JoueurLayout() {
  return (
    <div className="joueur-app joueur-layout min-h-screen" style={{ background: "var(--bg)" }}>
      <DesktopNavbar />
      <div className="pb-[calc(56px+env(safe-area-inset-bottom))] md:pb-8 md:pt-16">
        <Outlet />
      </div>
      <BottomNav />
    </div>
  );
}
