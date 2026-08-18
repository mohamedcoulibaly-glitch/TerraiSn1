import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Map,
  Users,
  Wallet,
  Scale,
  TrendingUp,
  CreditCard,
  Menu,
  X,
  Bell,
  LogOut,
  ChevronRight,
  ExternalLink,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { profileForUser } from "@/auth/roles";

export type SaCrumb = { label: string; to?: string };

type SaHeaderCtx = {
  crumbs: SaCrumb[];
  setCrumbs: (crumbs: SaCrumb[]) => void;
  alertCount: number;
  setAlertCount: (n: number) => void;
};

const SaHeaderContext = createContext<SaHeaderCtx | null>(null);

export function useSaHeader() {
  const ctx = useContext(SaHeaderContext);
  if (!ctx) throw new Error("useSaHeader must be used inside SuperadminLayout");
  return ctx;
}

export function useSaCrumbs(crumbs: SaCrumb[]) {
  const ctx = useContext(SaHeaderContext);
  const key = crumbs.map((c) => `${c.label}:${c.to || ""}`).join("|");
  useEffect(() => {
    if (!ctx) return;
    ctx.setCrumbs(crumbs);
    return () => ctx.setCrumbs([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

const FALLBACK_CRUMBS: Record<string, string> = {
  superadmin: "Tableau de bord",
  terrains: "Terrains",
  utilisateurs: "Utilisateurs",
  caisse: "Caisse & Reversements",
  rapprochement: "Rapprochement",
  revenus: "Revenus",
  abonnements: "Abonnements",
};

type NavEntry =
  | { kind: "link"; to: string; label: string; icon: typeof LayoutDashboard; end?: boolean }
  | { kind: "soon"; label: string; icon: typeof LayoutDashboard };

const SECTIONS: { title: string; items: NavEntry[] }[] = [
  {
    title: "Tableau de bord",
    items: [{ kind: "link", to: "/backoffice/superadmin", label: "Dashboard", icon: LayoutDashboard, end: true }],
  },
  {
    title: "Plateforme",
    items: [
      { kind: "link", to: "/backoffice/superadmin/terrains", label: "Terrains", icon: Map },
      { kind: "link", to: "/backoffice/superadmin/utilisateurs", label: "Utilisateurs", icon: Users },
    ],
  },
  {
    title: "Finance",
    items: [
      { kind: "link", to: "/backoffice/superadmin/caisse", label: "Caisse & Reversements", icon: Wallet },
      { kind: "link", to: "/backoffice/superadmin/rapprochement", label: "Rapprochement", icon: Scale },
      { kind: "link", to: "/backoffice/superadmin/revenus", label: "Revenus", icon: TrendingUp },
    ],
  },
  {
    title: "Configuration",
    items: [{ kind: "soon", label: "Abonnements", icon: CreditCard }],
  },
];

function initials(user: { prenom?: string; nom?: string } | null) {
  const p = (user?.prenom || "").trim();
  const n = (user?.nom || "").trim();
  return `${p.charAt(0)}${n.charAt(0)}`.toUpperCase() || "SA";
}

function displayName(user: { prenom?: string; nom?: string } | null) {
  const p = (user?.prenom || "").trim();
  const n = (user?.nom || "").trim();
  return [p, n].filter(Boolean).join(" ") || "Super Admin";
}

function SidebarNav({ onNavigate }: { onNavigate: () => void }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <aside
      className="flex flex-col h-full shrink-0"
      style={{ width: "var(--sa-sidebar-width)", background: "var(--sa-sidebar-bg)" }}
    >
      <div className="px-5 py-5" style={{ borderBottom: "1px solid var(--sa-sidebar-border)" }}>
        <p className="text-white text-[16px] font-black tracking-tight" style={{ fontFamily: "var(--font-display)" }}>
          TERRAIN.SN
        </p>
        <span
          className="mt-2 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold"
          style={{ background: "var(--sa-primary-glow)", color: "var(--sa-primary-light)" }}
        >
          Super Admin
        </span>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-4">
        {SECTIONS.map((section) => (
          <div key={section.title}>
            <p
              className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-wider"
              style={{ color: "var(--sa-sidebar-section)" }}
            >
              {section.title}
            </p>
            <div className="space-y-0.5">
              {section.items.map((item) => {
                if (item.kind === "soon") {
                  return (
                    <div
                      key={item.label}
                      className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] opacity-50 cursor-not-allowed"
                      style={{ color: "var(--sa-sidebar-text)" }}
                    >
                      <item.icon size={16} />
                      <span className="flex-1">{item.label}</span>
                      <span className="text-[9px] uppercase tracking-wide">Bientôt</span>
                    </div>
                  );
                }
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      `flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors ${
                        isActive ? "pl-[9px]" : ""
                      }`
                    }
                    style={({ isActive }) =>
                      isActive
                        ? {
                            background: "var(--sa-sidebar-active-bg)",
                            color: "var(--sa-sidebar-active)",
                            borderLeft: "3px solid var(--sa-primary-light)",
                          }
                        : { color: "var(--sa-sidebar-text)" }
                    }
                    onMouseEnter={(e) => {
                      if (!(e.currentTarget as HTMLAnchorElement).classList.contains("active")) {
                        e.currentTarget.style.background = "var(--sa-sidebar-hover)";
                        e.currentTarget.style.color = "#fff";
                      }
                    }}
                    onMouseLeave={(e) => {
                      const active = e.currentTarget.getAttribute("aria-current") === "page";
                      if (!active) {
                        e.currentTarget.style.background = "transparent";
                        e.currentTarget.style.color = "var(--sa-sidebar-text)";
                      }
                    }}
                  >
                    <item.icon size={16} />
                    {item.label}
                  </NavLink>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="px-3 py-4" style={{ borderTop: "1px solid var(--sa-sidebar-border)" }}>
        <button
          type="button"
          onClick={() => navigate(profileForUser(user))}
          className="w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-left"
        >
          <span
            className="w-8 h-8 rounded-full grid place-items-center text-[11px] font-bold shrink-0"
            style={{ background: "var(--sa-sidebar-active-bg)", color: "var(--sa-sidebar-active)" }}
          >
            {user?.photo_url ? (
              <img src={user.photo_url} alt="" className="w-full h-full object-cover rounded-full" />
            ) : (
              initials(user)
            )}
          </span>
          <span className="min-w-0">
            <span className="block text-[12px] font-semibold truncate" style={{ color: "var(--sa-sidebar-active)" }}>
              {displayName(user)}
            </span>
            <span className="block text-[10px]" style={{ color: "var(--sa-sidebar-text)" }}>
              Super Admin
            </span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => logout()}
          className="mt-1 w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium"
          style={{ color: "var(--sa-danger)" }}
        >
          <LogOut size={16} />
          Déconnexion
        </button>
      </div>
    </aside>
  );
}

export default function SuperadminLayout() {
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [crumbs, setCrumbs] = useState<SaCrumb[]>([]);
  const [alertCount, setAlertCount] = useState(0);

  const autoCrumbs = useMemo<SaCrumb[]>(() => {
    const parts = location.pathname.split("/").filter(Boolean);
    return parts.slice(1).map((seg, i, arr) => ({
      label: FALLBACK_CRUMBS[seg] || (Number.isNaN(Number(seg)) ? seg : `#${seg}`),
      to: "/" + parts.slice(0, i + 2).join("/"),
    }));
  }, [location.pathname]);

  const shown = crumbs.length ? crumbs : autoCrumbs;
  const ctx = useMemo(() => ({ crumbs, setCrumbs, alertCount, setAlertCount }), [crumbs, alertCount]);

  return (
    <SaHeaderContext.Provider value={ctx}>
      <div className="superadmin-app min-h-screen" style={{ background: "var(--sa-bg)" }}>
        <div className="hidden md:flex fixed inset-y-0 left-0 z-40">
          <SidebarNav onNavigate={() => {}} />
        </div>

        {mobileOpen ? (
          <div className="fixed inset-0 z-50 md:hidden">
            <button type="button" className="absolute inset-0" style={{ background: "rgba(10,22,40,0.45)" }} onClick={() => setMobileOpen(false)} aria-label="Fermer" />
            <div className="relative h-full" style={{ width: "var(--sa-sidebar-width)" }}>
              <SidebarNav onNavigate={() => setMobileOpen(false)} />
            </div>
          </div>
        ) : null}

        <div className="md:ml-[240px] min-h-screen flex flex-col">
          <header
            className="sticky top-0 z-30 flex items-center justify-between gap-3 px-4 md:px-6"
            style={{
              height: "var(--sa-header-height)",
              background: "var(--sa-surface)",
              borderBottom: "1px solid var(--sa-border)",
            }}
          >
            <div className="flex items-center gap-2 min-w-0">
              <button
                type="button"
                className="md:hidden p-2 rounded-lg"
                onClick={() => setMobileOpen(true)}
                aria-label="Menu"
              >
                {mobileOpen ? <X size={20} /> : <Menu size={20} />}
              </button>
              <nav className="flex items-center gap-1 text-[13px] overflow-x-auto scrollbar-hide" style={{ color: "var(--sa-muted)" }}>
                {shown.map((c, i) => (
                  <span key={`${c.label}-${i}`} className="flex items-center gap-1 shrink-0">
                    {i > 0 ? <ChevronRight size={14} /> : null}
                    {i === shown.length - 1 ? (
                      <span className="font-medium" style={{ color: "var(--sa-text)" }}>
                        {c.label}
                      </span>
                    ) : c.to ? (
                      <NavLink to={c.to} className="hover:underline">
                        {c.label}
                      </NavLink>
                    ) : (
                      <span>{c.label}</span>
                    )}
                  </span>
                ))}
              </nav>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <NavLink
                to="/backoffice/superadmin"
                className="relative inline-flex items-center justify-center w-9 h-9 rounded-lg"
                style={{ color: "var(--sa-text-2)" }}
                aria-label="Alertes"
              >
                <Bell size={18} />
                {alertCount > 0 ? (
                  <span
                    className="absolute top-1 right-1 min-w-[16px] h-4 px-1 rounded-full text-[9px] font-bold text-white grid place-items-center"
                    style={{ background: "var(--sa-danger)" }}
                  >
                    {alertCount > 9 ? "9+" : alertCount}
                  </span>
                ) : null}
              </NavLink>
              <a
                href="/"
                className="hidden sm:inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-[12px] font-semibold"
                style={{ border: "1px solid var(--sa-border)", color: "var(--sa-text-2)", background: "var(--sa-surface)" }}
              >
                <ExternalLink size={13} />
                Retour à l'app
              </a>
            </div>
          </header>
          <main className="flex-1 p-4 md:p-6">
            <Outlet />
          </main>
        </div>
      </div>
    </SaHeaderContext.Provider>
  );
}
