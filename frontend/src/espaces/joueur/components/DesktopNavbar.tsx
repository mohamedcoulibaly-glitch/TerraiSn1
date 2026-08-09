import { Search, User } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/use-auth";
import { profileForUser } from "@/auth/roles";
import { ThemeToggle } from "@/components/ThemeToggle";

export default function DesktopNavbar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { isAuthenticated, user } = useAuth();

  const profilPath = isAuthenticated && user ? profileForUser(user) : "/login";
  const initials =
    `${(user?.prenom || "").trim().charAt(0)}${(user?.nom || "").trim().charAt(0)}`.toUpperCase() ||
    "TS";
  const photo = user?.photo_url;

  const navItems = [
    { label: "Accueil", path: "/", match: (p: string) => p === "/" },
    { label: "Explorer", path: "/explorer", match: (p: string) => p.startsWith("/explorer") },
    {
      label: "Réservations",
      path: "/reservations",
      match: (p: string) => p === "/reservations" || p.startsWith("/reservation"),
    },
  ];

  return (
    <header className="hidden md:flex fixed top-0 inset-x-0 z-50 h-16 items-center bg-[var(--nav-bg)] backdrop-blur-xl border-b border-[var(--nav-border)]">
      <div className="h-full w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-6">
        <Link to="/" className="text-xl font-black tracking-tight text-[var(--text-primary)] shrink-0">
          TERRAIN<span className="text-[var(--primary)]">.SN</span>
        </Link>

        <nav className="flex items-center gap-1">
          {navItems.map((item) => {
            const active = item.match(location.pathname);
            return (
              <button
                key={item.label}
                type="button"
                onClick={() => navigate(item.path)}
                className={`min-h-[44px] px-4 rounded-xl text-sm font-semibold transition-colors ${
                  active
                    ? "bg-[var(--primary-glow)] text-[var(--primary)]"
                    : "text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)]"
                }`}
                aria-current={active ? "page" : undefined}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="flex items-center gap-3 shrink-0">
          <ThemeToggle />
          <button
            type="button"
            onClick={() => navigate("/explorer")}
            className="inline-flex items-center gap-2 min-h-[44px] px-4 rounded-xl border border-[var(--border)] text-[var(--text-secondary)] text-sm font-medium hover:border-[var(--primary)] hover:text-[var(--primary)] transition-colors"
          >
            <Search className="w-4 h-4" />
            Rechercher
          </button>
          <button
            type="button"
            onClick={() => navigate(profilPath)}
            className="w-10 h-10 rounded-full overflow-hidden bg-[var(--surface-2)] border border-[var(--border)] flex items-center justify-center text-sm font-bold text-[var(--text-primary)]"
            aria-label="Profil"
          >
            {photo ? (
              <img src={photo} alt="" className="w-full h-full object-cover" />
            ) : (
              <span>{isAuthenticated ? initials : <User className="w-4 h-4 text-[var(--text-muted)]" />}</span>
            )}
          </button>
        </div>
      </div>
    </header>
  );
}
