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
    <nav
      className="bottom-nav md:hidden border-t border-[var(--nav-border)] bg-[var(--nav-bg)] pt-2 backdrop-blur-xl pb-[max(1.25rem,env(safe-area-inset-bottom,0px))]"
      aria-label="Navigation principale"
    >
      <div className="mx-auto grid h-[52px] max-w-xl grid-cols-4 items-center px-1">
        {navItems.map((item) => {
          const isActive = item.match(location.pathname);
          return (
            <button
              key={item.label}
              type="button"
              onClick={() => navigate(item.path)}
              className={`flex h-full w-full flex-col items-center justify-center gap-1 px-1 ${
                isActive ? "text-[var(--primary)]" : "text-[var(--text-muted)]"
              }`}
              aria-label={item.label}
              aria-current={isActive ? "page" : undefined}
            >
              <item.icon className="h-5 w-5 shrink-0" strokeWidth={isActive ? 2.4 : 2} />
              <span className="text-[10px] font-medium leading-none">{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};

export default BottomNav;
