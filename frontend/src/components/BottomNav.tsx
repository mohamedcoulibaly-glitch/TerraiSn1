import { Home, Search, Calendar, User } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";

const navItems = [
  { icon: Home, label: "Accueil", path: "/" },
  { icon: Search, label: "Explorer", path: "/explorer" },
  { icon: Calendar, label: "Réservations", path: "/reservations" },
  { icon: User, label: "Profil", path: "/profil" },
];

const BottomNav = () => {
  const location = useLocation();
  const navigate = useNavigate();

  // Hide on admin/owner/manager/auth pages
  const hiddenPaths = ["/proprietaire", "/gerant", "/connexion"];
  if (hiddenPaths.some(p => location.pathname.startsWith(p))) {
    return null;
  }

  return (
    <nav className="bottom-nav">
      <div className="flex items-center justify-around py-2 px-4 max-w-xl mx-auto">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={`flex flex-col items-center gap-0.5 py-1 px-3 sm:px-5 rounded-xl transition-colors ${
                isActive ? "text-primary" : "text-muted-foreground"
              }`}
            >
              <item.icon className={`w-5 h-5 sm:w-6 sm:h-6 ${isActive ? "fill-primary/20" : ""}`} />
              <span className="text-[10px] sm:text-xs font-medium">{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};

export default BottomNav;
