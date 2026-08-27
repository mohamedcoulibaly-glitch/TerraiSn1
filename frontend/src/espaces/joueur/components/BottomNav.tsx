import { Home, Search, Calendar, User } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/use-auth";
import { profileForUser } from "@/auth/roles";
import { hapticSelection } from "@/lib/haptics";

const BottomNav = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { isAuthenticated, user } = useAuth();

  const profilPath = isAuthenticated && user ? profileForUser(user) : "/login";

  const navItems = [
    { icon: Home, label: "Accueil", path: "/", match: (p: string) => p === "/" },
    { icon: Search, label: "Explorer", path: "/explorer", match: (p: string) => p.startsWith("/explorer") },
    {
      icon: Calendar,
      label: "Réservations",
      path: "/reservations",
      match: (p: string) => p === "/reservations" || p.startsWith("/reservation"),
    },
    {
      icon: User,
      label: "Profil",
      path: profilPath,
      match: (p: string) =>
        p.startsWith("/profil") || p === "/login" || p.startsWith("/espace-joueur"),
    },
  ];

  const handleNav = (path: string) => {
    hapticSelection();
    navigate(path);
  };

  return (
    <nav
      className="md:hidden fixed bottom-0 inset-x-0 z-40 pb-[env(safe-area-inset-bottom)] gpu-transition"
      style={{ background: "var(--nav-bg)", borderTop: "1px solid var(--nav-border)" }}
      aria-label="Navigation principale"
    >
      <div className="grid grid-cols-4 max-w-lg mx-auto">
        {navItems.map((item) => {
          const isActive = item.match(location.pathname);
          return (
            <button
              key={item.label}
              type="button"
              onClick={() => handleNav(item.path)}
              className="flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-[transform,opacity] duration-150 active:scale-95"
              style={{ color: isActive ? "var(--primary)" : "var(--text-muted)" }}
              aria-label={item.label}
              aria-current={isActive ? "page" : undefined}
            >
              <item.icon className="h-5 w-5 shrink-0" strokeWidth={isActive ? 2.4 : 2} />
              {item.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
};

export default BottomNav;
