import { Outlet } from "react-router-dom";
import BottomNav from "@/espaces/joueur/components/BottomNav";
import DesktopNavbar from "@/espaces/joueur/components/DesktopNavbar";

/**
 * Layout espace joueur — responsive :
 * - Mobile : BottomNav dark glass
 * - Tablette+ (≥ md) : DesktopNavbar fixe, BottomNav masquée
 */
export default function JoueurLayout() {
  return (
    <div className="joueur-app joueur-layout min-h-screen bg-[var(--color-bg)]">
      <DesktopNavbar />
      <div className="pb-[calc(6.25rem+env(safe-area-inset-bottom,0px))] md:pb-8 md:pt-16">
        <Outlet />
      </div>
      <BottomNav />
    </div>
  );
}
