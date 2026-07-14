import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Calendar,
  HandCoins,
  User,
  LogOut,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { gerantApi } from "@/lib/api";

const TABS = [
  { to: "/backoffice/gerant", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/backoffice/gerant/creneaux", label: "Créneaux", icon: Calendar },
  { to: "/backoffice/gerant/reservations", label: "Réservations", icon: HandCoins },
] as const;

function initials(user: { prenom?: string; nom?: string } | null) {
  const p = (user?.prenom || "").trim();
  const n = (user?.nom || "").trim();
  if (p || n) return `${p.charAt(0)}${n.charAt(0)}`.toUpperCase() || "G";
  return "G";
}

/**
 * Shell gérant — bottom tabs mobile, sidebar ≥768px, header vert.
 */
export default function GerantChrome() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [terrainName, setTerrainName] = useState("Mon terrain");
  const [profilOpen, setProfilOpen] = useState(false);

  useEffect(() => {
    gerantApi
      .dashboard()
      .then((d: any) => {
        if (d?.terrain?.nom) setTerrainName(d.terrain.nom);
      })
      .catch(() => {});
  }, []);

  const handleLogout = () => {
    logout();
    navigate("/backoffice/login");
  };

  const Sidebar = (
    <aside className="flex flex-col w-[220px] min-h-full bg-[var(--color-sidebar)] text-white shrink-0">
      <div className="px-5 py-6 border-b border-white/10">
        <p
          className="text-[15px] font-semibold tracking-tight"
          style={{ fontFamily: "var(--font-display)" }}
        >
          TerrainSN
        </p>
        <p className="text-[11px] text-white/45 mt-1 truncate">{terrainName}</p>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={"end" in tab ? tab.end : false}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? "bg-[var(--color-sidebar-active)] text-white border-l-[3px] border-[var(--color-accent)] pl-[9px]"
                  : "text-white/65 hover:bg-[var(--color-sidebar-hover)] hover:text-white"
              }`
            }
          >
            <tab.icon size={18} />
            {tab.label}
          </NavLink>
        ))}
        <button
          type="button"
          onClick={() => setProfilOpen(true)}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-white/65 hover:bg-[var(--color-sidebar-hover)] hover:text-white"
        >
          <User size={18} />
          Profil
        </button>
      </nav>
      <button
        type="button"
        onClick={handleLogout}
        className="m-3 flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-white/55 hover:bg-[var(--color-sidebar-hover)] hover:text-white"
      >
        <LogOut size={18} />
        Déconnexion
      </button>
    </aside>
  );

  return (
    <div className="flex min-h-screen bg-[var(--color-bg)]">
      <div className="hidden md:flex sticky top-0 h-screen">{Sidebar}</div>

      <div className="flex-1 flex flex-col min-w-0 pb-[calc(56px+env(safe-area-inset-bottom))] md:pb-0">
        <header className="sticky top-0 z-30 h-14 bg-[var(--color-primary)] text-white px-4 flex items-center justify-between gap-3">
          <p
            className="font-semibold text-[15px] truncate"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {terrainName}
          </p>
          <button
            type="button"
            onClick={() => setProfilOpen(true)}
            className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-white text-[var(--color-primary)] text-xs font-semibold shrink-0"
            aria-label="Profil"
          >
            {initials(user)}
          </button>
        </header>

        <main className="flex-1 p-4 md:p-6 overflow-auto">
          <Outlet />
        </main>
      </div>

      {/* Bottom tabs — mobile only */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-[var(--color-border)] pb-[env(safe-area-inset-bottom)]">
        <div className="grid grid-cols-4 max-w-lg mx-auto">
          {TABS.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${
                  isActive ? "text-[var(--color-primary)]" : "text-[var(--color-text-muted)]"
                }`
              }
            >
              <Icon className="w-5 h-5" />
              {label}
            </NavLink>
          ))}
          <button
            type="button"
            onClick={() => setProfilOpen(true)}
            className={`flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${
              profilOpen ? "text-[var(--color-primary)]" : "text-[var(--color-text-muted)]"
            }`}
          >
            <User className="w-5 h-5" />
            Profil
          </button>
        </div>
      </nav>

      {profilOpen && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/40" onClick={() => setProfilOpen(false)} />
          <div className="absolute bottom-0 inset-x-0 md:bottom-auto md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:w-full md:max-w-sm bg-white rounded-t-[var(--radius-xl)] md:rounded-[var(--radius-lg)] p-6 shadow-xl">
            <div className="flex items-start justify-between gap-3 mb-5">
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-[var(--color-primary)] text-white text-sm font-semibold">
                  {initials(user)}
                </span>
                <div>
                  <p
                    className="font-semibold text-[var(--color-text-primary)]"
                    style={{ fontFamily: "var(--font-display)" }}
                  >
                    {[user?.prenom, user?.nom].filter(Boolean).join(" ") || user?.nom || "Gérant"}
                  </p>
                  <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{terrainName}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setProfilOpen(false)}
                className="p-2 rounded-lg hover:bg-[var(--color-surface-2)]"
                aria-label="Fermer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              className="w-full min-h-[52px] rounded-[var(--radius-md)] border border-[var(--color-border)] text-[var(--color-danger)] text-sm font-medium inline-flex items-center justify-center gap-2"
            >
              <LogOut className="w-4 h-4" />
              Se déconnecter
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
