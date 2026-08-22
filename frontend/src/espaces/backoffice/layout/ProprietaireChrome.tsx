import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { LayoutDashboard, TrendingUp, MapPin, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { profileForUser } from "@/auth/roles";
import { proprietaireApi } from "@/lib/api";
import { useOwnerRealtime } from "@/hooks/useOwnerRealtime";

const TABS = [
  { id: "dashboard", label: "Aperçu", icon: LayoutDashboard, route: "/backoffice/proprietaire", end: true },
  { id: "revenus", label: "Revenus", icon: TrendingUp, route: "/backoffice/proprietaire/revenus", end: false },
  { id: "sante", label: "Santé", icon: ShieldCheck, route: "/backoffice/proprietaire/sante", end: false },
  { id: "terrains", label: "Terrains", icon: MapPin, route: "/backoffice/proprietaire/terrains", end: false },
] as const;

type HeaderUser = { prenom?: string; nom?: string; photo_url?: string } | null;

function initials(user: HeaderUser) {
  const p = (user?.prenom || "").trim();
  const n = (user?.nom || "").trim();
  return `${p.charAt(0)}${n.charAt(0)}`.toUpperCase() || "P";
}

function firstName(user: HeaderUser) {
  if (user?.prenom?.trim()) return user.prenom.trim();
  if (user?.nom?.trim()) return user.nom.trim().split(" ")[0];
  return "Propriétaire";
}

function tabActive(route: string, end: boolean, pathname: string) {
  if (end) return pathname === route;
  return pathname.startsWith(route);
}

function HeaderAvatar({ user }: { user: HeaderUser }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => navigate(profileForUser(user))}
      className="inline-flex items-center justify-center w-9 h-9 rounded-full overflow-hidden shrink-0"
      style={{ border: "2px solid var(--p-primary)", background: "var(--p-primary-glow)", color: "var(--p-primary)" }}
      aria-label="Profil"
    >
      {user?.photo_url ? (
        <img src={user.photo_url} alt="" className="w-full h-full object-cover" />
      ) : (
        <span className="text-xs font-semibold">{initials(user)}</span>
      )}
    </button>
  );
}

export default function ProprietaireChrome() {
  const { user } = useAuth();
  const location = useLocation();
  const [terrainCount, setTerrainCount] = useState(0);
  const [terrainIds, setTerrainIds] = useState<number[]>([]);

  useEffect(() => {
    proprietaireApi
      .terrains()
      .then((list) => {
        const rows = Array.isArray(list) ? list : [];
        setTerrainCount(rows.length);
        setTerrainIds(rows.map((t: { id: number }) => Number(t.id)).filter((id: number) => id > 0));
      })
      .catch(() => {
        setTerrainCount(0);
        setTerrainIds([]);
      });
  }, []);

  const live = useOwnerRealtime(terrainIds, () => {});
  const greeting = `Bonjour ${firstName(user)} 👋`;
  const subtitle =
    terrainCount === 0
      ? "Aucun terrain"
      : `${terrainCount} terrain${terrainCount > 1 ? "s" : ""}`;

  const Sidebar = (
    <aside
      className="flex flex-col w-[220px] min-h-full shrink-0"
      style={{ background: "var(--p-surface)", borderRight: "1px solid var(--p-border)" }}
    >
      <div className="px-5 py-6" style={{ borderBottom: "1px solid var(--p-border)" }}>
        <p className="text-[15px] font-semibold tracking-tight" style={{ fontFamily: "var(--font-display)", color: "var(--p-text)" }}>
          TerrainSN
        </p>
        <p className="text-[11px] mt-1" style={{ color: "var(--p-muted)" }}>
          Espace propriétaire
        </p>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1">
        {TABS.map((tab) => {
          const active = tabActive(tab.route, tab.end, location.pathname);
          return (
            <NavLink
              key={tab.id}
              to={tab.route}
              end={tab.end}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium min-h-[44px]"
              style={{
                background: active ? "var(--p-primary-glow)" : "transparent",
                color: active ? "var(--p-nav-active)" : "var(--p-muted)",
                borderLeft: active ? "3px solid var(--p-nav-active)" : "3px solid transparent",
              }}
            >
              <tab.icon size={18} />
              {tab.label}
            </NavLink>
          );
        })}
      </nav>
    </aside>
  );

  return (
    <div className="proprio-app flex min-h-screen" style={{ background: "var(--p-bg)" }}>
      <div className="hidden md:flex sticky top-0 h-screen">{Sidebar}</div>

      <div className="flex-1 flex flex-col min-w-0 pb-[calc(56px+env(safe-area-inset-bottom))] md:pb-0">
        <header
          className="sticky top-0 z-30 h-14 px-4 flex items-center justify-between gap-3"
          style={{ background: "var(--p-surface)", borderBottom: "1px solid var(--p-border)" }}
        >
          <div className="min-w-0">
            <p className="font-bold text-[16px] truncate leading-tight" style={{ color: "var(--p-text)" }}>
              {greeting}
            </p>
            <p className="text-[12px] truncate" style={{ color: "var(--p-muted)" }}>
              {subtitle}
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span className="hidden sm:inline-flex items-center gap-1.5 text-[11px] font-medium">
              <span
                className={`w-1.5 h-1.5 rounded-full ${live ? "animate-pulse" : ""}`}
                style={{ background: live ? "var(--p-live)" : "var(--p-verifier)" }}
              />
              <span style={{ color: live ? "var(--p-optimal)" : "var(--p-verifier)" }}>
                {live ? "En direct" : "Hors ligne"}
              </span>
            </span>
            <HeaderAvatar user={user} />
          </div>
        </header>

        <main className="flex-1 p-3 md:p-6 overflow-auto">
          <Outlet />
        </main>
      </div>

      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-40 pb-[env(safe-area-inset-bottom)]"
        style={{ background: "var(--p-nav-bg)", borderTop: "1px solid var(--p-nav-border)" }}
      >
        <div className="grid grid-cols-4 max-w-lg mx-auto">
          {TABS.map((tab) => {
            const active = tabActive(tab.route, tab.end, location.pathname);
            return (
              <NavLink
                key={tab.id}
                to={tab.route}
                end={tab.end}
                className="flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-[11px] font-medium"
                style={{ color: active ? "var(--p-nav-active)" : "var(--p-muted)" }}
              >
                <tab.icon className="w-5 h-5" />
                {tab.label}
              </NavLink>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
