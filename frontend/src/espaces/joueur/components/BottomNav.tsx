import { Home, Search, Calendar, User } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";

const navItems = [
  { icon: Home, label: "Accueil", path: "/", match: (p: string) => p === "/" },
  { icon: Search, label: "Explorer", path: "/explorer", match: (p: string) => p.startsWith("/explorer") },
  {
    icon: Calendar,
    label: "Réservations",
    path: "/reservations",
    match: (p: string) => p === "/reservations" || p.startsWith("/reservation"),
  },
  { icon: User, label: "Profil", path: "/profil", match: (p: string) => p.startsWith("/profil") },
];

const BottomNav = () => {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <nav className="bottom-nav">
      <div className="grid grid-cols-4 items-stretch max-w-xl mx-auto">
        {navItems.map((item) => {
          const isActive = item.match(location.pathname);
          return (
            <button
              key={item.path}
              type="button"
              onClick={() => navigate(item.path)}
              className={`flex w-full min-h-[52px] flex-col items-center justify-center gap-0.5 px-1 transition-colors ${
                isActive ? "text-[var(--color-primary)]" : "text-[var(--color-text-muted)]"
              }`}
            >
              <item.icon className={`w-5 h-5 ${isActive ? "stroke-[2.25]" : ""}`} />
              <span className="text-[11px] font-medium">{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};

export default BottomNav;
