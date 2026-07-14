import { Outlet } from "react-router-dom";
import BottomNav from "@/espaces/joueur/components/BottomNav";
import JoueurNavbar from "@/espaces/joueur/components/JoueurNavbar";

/**
 * Layout espace joueur — mobile-first.
 * Navbar blanche + bottom nav.
 */
export default function JoueurLayout() {
  return (
    <div className="joueur-layout min-h-screen bg-[var(--color-bg)]">
      <JoueurNavbar />
      <div className="pt-14 pb-20">
        <Outlet />
      </div>
      <BottomNav />
    </div>
  );
}
