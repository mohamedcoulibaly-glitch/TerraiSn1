import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, Map, Users, Banknote, Calendar, HandCoins,
  BarChart3, LogOut, Menu, X, ChevronRight,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { normalizeRole, AppRole } from "@/auth/roles";
import GerantChrome from "@/espaces/backoffice/layout/GerantChrome";
import ProprietaireChrome from "@/espaces/backoffice/layout/ProprietaireChrome";

type NavItem = { to: string; label: string; icon: typeof LayoutDashboard; end?: boolean };

const NAV_BY_ROLE: Record<Exclude<AppRole, "joueur">, NavItem[]> = {
  super_admin: [
    { to: "/backoffice/admin", label: "Dashboard", icon: LayoutDashboard, end: true },
    { to: "/backoffice/admin/terrains", label: "Terrains", icon: Map },
    { to: "/backoffice/admin/utilisateurs", label: "Utilisateurs", icon: Users },
    { to: "/backoffice/admin/revenus", label: "Revenus", icon: Banknote },
  ],
  gerant: [
    { to: "/backoffice/gerant", label: "Dashboard", icon: LayoutDashboard, end: true },
    { to: "/backoffice/gerant/creneaux", label: "Créneaux", icon: Calendar },
    { to: "/backoffice/gerant/reservations", label: "Résa manuelle", icon: HandCoins },
  ],
  proprietaire: [
    { to: "/backoffice/proprietaire", label: "Dashboard", icon: LayoutDashboard, end: true },
    { to: "/backoffice/proprietaire/revenus", label: "Mes revenus", icon: BarChart3 },
  ],
};

const ROLE_LABEL: Record<string, string> = {
  super_admin: "Super Admin",
  gerant: "Gérant",
  proprietaire: "Propriétaire",
};

const CRUMB_LABELS: Record<string, string> = {
  backoffice: "Backoffice",
  admin: "Administration",
  gerant: "Gérant",
  proprietaire: "Propriétaire",
  terrains: "Terrains",
  utilisateurs: "Utilisateurs",
  revenus: "Revenus",
  creneaux: "Créneaux",
  reservations: "Réservations",
  terrain: "Terrain",
};

export default function BackofficeLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const role = normalizeRole(user);
  const [mobileOpen, setMobileOpen] = useState(false);

  if (role === "gerant") {
    return <GerantChrome />;
  }

  if (role === "proprietaire") {
    return <ProprietaireChrome />;
  }

  const links = role && role !== "joueur" ? NAV_BY_ROLE[role] : [];

  const crumbs = useMemo(() => {
    return location.pathname
      .split("/")
      .filter(Boolean)
      .map((segment, index, arr) => ({
        label: CRUMB_LABELS[segment] || (Number.isNaN(Number(segment)) ? segment : `#${segment}`),
        path: "/" + arr.slice(0, index + 1).join("/"),
        isLast: index === arr.length - 1,
      }));
  }, [location.pathname]);

  const handleLogout = () => {
    logout();
    navigate("/backoffice/login");
  };

  const Sidebar = (
    <aside className="flex flex-col w-[240px] min-h-full bg-[var(--color-sidebar)] text-white shrink-0">
      <div className="px-5 py-6 border-b border-white/10">
        <div className="flex items-center gap-2.5">
          <span
            className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-[var(--color-primary)] text-sm font-semibold"
            style={{ fontFamily: "var(--font-display)" }}
          >
            TS
          </span>
          <div>
            <p
              className="text-[15px] font-semibold tracking-tight leading-tight text-white"
              style={{ fontFamily: "var(--font-display)" }}
            >
              TerrainSN
            </p>
            <p className="text-[11px] text-white/45 mt-0.5">Super admin</p>
          </div>
        </div>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1">
        {links.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={() => setMobileOpen(false)}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-[colors] duration-200 ${
                isActive
                  ? "bg-[var(--color-sidebar-active)] text-white border-l-[3px] border-[var(--color-accent)] pl-[9px]"
                  : "text-white/65 hover:bg-[var(--color-sidebar-hover)] hover:text-white"
              }`
            }
          >
            <Icon size={18} />
            {label}
          </NavLink>
        ))}
      </nav>
      <button
        type="button"
        onClick={handleLogout}
        className="m-3 flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-white/55 hover:bg-[var(--color-sidebar-hover)] hover:text-white transition-[colors] duration-200"
      >
        <LogOut size={18} />
        Déconnexion
      </button>
    </aside>
  );

  return (
    <div className="flex min-h-screen bg-[var(--color-bg)]">
      <div className="hidden md:flex sticky top-0 h-screen">{Sidebar}</div>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <div className="relative h-full w-[240px] shadow-xl">{Sidebar}</div>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-30 bg-white border-b border-[var(--color-border)] px-4 md:px-6 py-3.5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              className="md:hidden p-2 rounded-lg hover:bg-[var(--color-surface-2)]"
              onClick={() => setMobileOpen(true)}
              aria-label="Menu"
            >
              {mobileOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
            <nav className="flex items-center gap-1 text-sm text-[var(--color-text-secondary)] overflow-x-auto scrollbar-hide">
              {crumbs.map((c) => (
                <span key={c.path} className="flex items-center gap-1 shrink-0">
                  {c.isLast ? (
                    <span className="text-[var(--color-text-primary)] font-medium">{c.label}</span>
                  ) : (
                    <>
                      <span>{c.label}</span>
                      <ChevronRight className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />
                    </>
                  )}
                </span>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-2.5 shrink-0">
            <span className="text-sm font-medium text-[var(--color-text-primary)] truncate max-w-[140px]">
              {user?.nom || "Utilisateur"}
            </span>
            {role === "super_admin" && (
              <span
                className="text-[11px] px-2.5 py-0.5 rounded-full font-medium"
                style={{
                  background: "color-mix(in srgb, var(--color-accent) 20%, white)",
                  color: "var(--color-accent)",
                }}
              >
                Super Admin
              </span>
            )}
          </div>
        </header>
        <main className="flex-1 p-4 md:p-6 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
