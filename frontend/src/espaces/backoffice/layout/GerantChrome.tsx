import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Calendar,
  HandCoins,
  Wallet,
  BadgePercent,
  Columns,
  Users,
  MoreHorizontal,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { gerantApi } from "@/lib/api";
import { profileForUser } from "@/auth/roles";
import { ThemeToggle } from "@/components/ThemeToggle";

const SIDEBAR = [
  { to: "/backoffice/gerant", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/backoffice/gerant/flux", label: "Flux du jour", icon: Columns },
  { to: "/backoffice/gerant/creneaux", label: "Créneaux", icon: Calendar },
  { to: "/backoffice/gerant/joueurs", label: "Joueurs", icon: Users },
  { to: "/backoffice/gerant/reservations", label: "Résas", icon: HandCoins },
  { to: "/backoffice/gerant/portefeuille", label: "Portefeuille", icon: Wallet },
  { to: "/backoffice/gerant/tarifs", label: "Tarifs", icon: BadgePercent },
] as const;

const MOBILE_PRIMARY = [
  { to: "/backoffice/gerant/flux", label: "Flux", icon: Columns },
  { to: "/backoffice/gerant/creneaux", label: "Créneaux", icon: Calendar },
  { to: "/backoffice/gerant/joueurs", label: "Joueurs", icon: Users },
  { to: "/backoffice/gerant/reservations", label: "Résas", icon: HandCoins },
] as const;

const MOBILE_MORE = [
  { to: "/backoffice/gerant", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/backoffice/gerant/tarifs", label: "Tarifs", icon: BadgePercent },
  { to: "/backoffice/gerant/portefeuille", label: "Portefeuille", icon: Wallet },
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

function linkClass(isActive: boolean) {
  return `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
    isActive
      ? "bg-[var(--color-sidebar-active)] text-white border-l-[3px] border-[var(--color-accent)] pl-[9px]"
      : "text-white/65 hover:bg-[var(--color-sidebar-hover)] hover:text-white"
  }`;
}

export default function GerantChrome() {
  const { user } = useAuth();
  const location = useLocation();
  const [terrainName, setTerrainName] = useState("Mon terrain");
  const [waConnected, setWaConnected] = useState<boolean | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);

  const moreActive = MOBILE_MORE.some((tab) =>
    tab.end ? location.pathname === tab.to : location.pathname.startsWith(tab.to),
  );

  useEffect(() => {
    gerantApi
      .dashboard()
      .then((data: GerantDashboardPayload) => {
        if (data?.terrain?.nom) setTerrainName(data.terrain.nom);
      })
      .catch(() => {});
    gerantApi
      .whatsappStatus()
      .then((data: { connected?: boolean; mock?: boolean }) => {
        setWaConnected(Boolean(data?.connected) && !data?.mock);
      })
      .catch(() => setWaConnected(false));
  }, []);

  const Sidebar = (
    <aside className="flex flex-col w-[220px] min-h-full bg-[var(--color-sidebar)] text-white shrink-0">
      <div className="px-5 py-6 border-b border-white/10">
        <p className="text-[15px] font-semibold tracking-tight" style={{ fontFamily: "var(--font-display)" }}>
          TerrainSN
        </p>
        <p className="text-[11px] text-white/45 mt-1 truncate">{terrainName}</p>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {SIDEBAR.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={"end" in tab ? tab.end : false}
            className={({ isActive }) => linkClass(isActive)}
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
          <div className="flex items-center gap-2 shrink-0">
            {waConnected != null && (
              <span
                className={`hidden sm:inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-1 rounded-full ${
                  waConnected ? "bg-white/15 text-white" : "bg-black/20 text-amber-200"
                }`}
                title={waConnected ? "WhatsApp gérant connecté" : "WhatsApp gérant à connecter"}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${waConnected ? "bg-[#25D366]" : "bg-amber-300"}`} />
                WA
              </span>
            )}
            <ThemeToggle variant="inverse" />
            <HeaderAvatar user={user} />
          </div>
        </header>

        <main className={`flex-1 overflow-auto ${location.pathname.includes("/gerant/flux") ? "p-0 md:p-6" : "p-4 md:p-6"}`}>
          <Outlet />
        </main>
      </div>

      {moreOpen && (
        <div className="md:hidden fixed inset-0 z-50">
          <button type="button" className="absolute inset-0 bg-black/40" aria-label="Fermer" onClick={() => setMoreOpen(false)} />
          <div className="absolute bottom-0 inset-x-0 bg-white rounded-t-[var(--radius-lg)] border-t border-[var(--color-border)] pb-[calc(12px+env(safe-area-inset-bottom))]">
            <div className="flex items-center justify-between px-4 py-3">
              <p className="text-sm font-semibold">Plus</p>
              <div className="flex items-center gap-2">
                <ThemeToggle />
                <button type="button" onClick={() => setMoreOpen(false)} className="p-2" aria-label="Fermer">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="px-2 pb-2">
              {MOBILE_MORE.map((tab) => (
                <NavLink
                  key={tab.to}
                  to={tab.to}
                  end={"end" in tab ? tab.end : false}
                  onClick={() => setMoreOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium ${
                      isActive ? "bg-[var(--color-surface-2)] text-[var(--color-primary)]" : "text-[var(--color-text-primary)]"
                    }`
                  }
                >
                  <tab.icon size={18} />
                  {tab.label}
                </NavLink>
              ))}
            </div>
          </div>
        </div>
      )}

      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-[var(--color-border)] pb-[env(safe-area-inset-bottom)]">
        <div className="grid grid-cols-5 max-w-lg mx-auto">
          {MOBILE_PRIMARY.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
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
            onClick={() => setMoreOpen(true)}
            className={`flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${
              moreActive ? "text-[var(--color-primary)]" : "text-[var(--color-text-muted)]"
            }`}
          >
            <MoreHorizontal className="w-5 h-5" />
            Plus
          </button>
        </div>
      </nav>
    </div>
  );
}
