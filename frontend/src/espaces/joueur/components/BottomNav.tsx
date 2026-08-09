import { Home, Search, Calendar, User } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/use-auth";
import { profileForUser } from "@/auth/roles";

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

  return (
    <nav className="bottom-nav md:hidden h-16 bg-[var(--nav-bg)] backdrop-blur-xl border-t border-[var(--nav-border)]">
      <div className="grid grid-cols-4 items-stretch h-16 max-w-xl mx-auto px-1">
        {navItems.map((item) => {
          const isActive = item.match(location.pathname);
          return (
            <button
              key={item.label}
              type="button"
              onClick={() => navigate(item.path)}
              className={`relative flex w-full min-h-[44px] flex-col items-center justify-center gap-0.5 px-1 ${
                isActive ? "text-[var(--primary)]" : "text-[var(--text-muted)]"
              }`}
              aria-current={isActive ? "page" : undefined}
            >
              <item.icon
                className="w-[22px] h-[22px] transition-transform duration-200"
                style={isActive ? { transform: "scale(1.15)" } : undefined}
              />
              {isActive && (
                <span className="absolute bottom-1.5 w-1 h-1 rounded-full bg-[var(--primary)] pulse-dot" />
              )}
              <span
                className={`text-[11px] font-medium leading-none mt-0.5 ${
                  isActive
                    ? "opacity-100"
                    : "opacity-0 sm:opacity-100 h-0 sm:h-auto overflow-hidden sm:overflow-visible"
                }`}
              >
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};

export default BottomNav;
