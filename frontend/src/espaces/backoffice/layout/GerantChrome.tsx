import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { LayoutDashboard, Calendar, HandCoins, ScanLine } from "lucide-react";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { gerantApi } from "@/lib/api";
import { profileForUser } from "@/auth/roles";

const TABS = [
  { to: "/backoffice/gerant", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/backoffice/gerant/creneaux", label: "Creneaux", icon: Calendar },
  { to: "/backoffice/gerant/reservations", label: "Reservations", icon: HandCoins },
  { to: "/backoffice/gerant/scanner", label: "Scanner", icon: ScanLine },
] as const;

type HeaderUser = { prenom?: string; nom?: string; photo_url?: string } | null;
type GerantDashboardPayload = { terrain?: { nom?: string } };

function initials(user: HeaderUser) {
  const p = (user?.prenom || "").trim();
  const n = (user?.nom || "").trim();
  return `${p.charAt(0)}${n.charAt(0)}`.toUpperCase() || "G";
}

function HeaderAvatar({ user }: { user: HeaderUser }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => navigate(profileForUser(user))}
      className="inline-flex items-center justify-center w-9 h-9 rounded-full overflow-hidden border-2 border-white bg-white text-[var(--color-primary)] text-xs font-semibold shrink-0"
      aria-label="Profil"
    >
      {user?.photo_url ? <img src={user.photo_url} alt="" className="w-full h-full object-cover" /> : initials(user)}
    </button>
  );
}

export default function GerantChrome() {
  const { user } = useAuth();
  const [terrainName, setTerrainName] = useState("Mon terrain");

  useEffect(() => {
    gerantApi
      .dashboard()
      .then((data: GerantDashboardPayload) => {
        if (data?.terrain?.nom) setTerrainName(data.terrain.nom);
      })
      .catch(() => {});
  }, []);

  const Sidebar = (
    <aside className="flex flex-col w-[220px] min-h-full bg-[var(--color-sidebar)] text-white shrink-0">
      <div className="px-5 py-6 border-b border-white/10">
        <p className="text-[15px] font-semibold tracking-tight" style={{ fontFamily: "var(--font-display)" }}>
          TerrainSN
        </p>
        <p className="text-[11px] text-white/45 mt-1 truncate">{terrainName}</p>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
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
      </nav>
    </aside>
  );

  return (
    <div className="flex min-h-screen bg-[var(--color-bg)]">
      <div className="hidden md:flex sticky top-0 h-screen">{Sidebar}</div>

      <div className="flex-1 flex flex-col min-w-0 pb-[calc(56px+env(safe-area-inset-bottom))] md:pb-0">
        <header className="sticky top-0 z-30 h-14 bg-[var(--color-primary)] text-white px-4 flex items-center justify-between gap-3">
          <p className="font-semibold text-[15px] truncate" style={{ fontFamily: "var(--font-display)" }}>
            {terrainName}
          </p>
          <HeaderAvatar user={user} />
        </header>

        <main className="flex-1 p-4 md:p-6 overflow-auto">
          <Outlet />
        </main>
      </div>

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
        </div>
      </nav>
    </div>
  );
}
