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
  ExternalLink,
  Sparkles,
  MessageCircle,
  CircleDot,
  ClipboardList,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { profileForUser } from "@/auth/roles";
import { useWhatsappInfra } from "@/hooks/useWhatsappInfra";
import WhatsAppInfraBanner from "@/espaces/backoffice/components/WhatsAppInfraBanner";

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
  if (!ctx) {
    return { crumbs: [], setCrumbs: () => {}, alertCount: 0, setAlertCount: () => {} };
  }
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
  commodites: "Commodités",
  whatsapp: "WhatsApp",
  audit: "Audit",
};

type NavEntry =
  | { kind: "link"; to: string; label: string; icon: typeof LayoutDashboard; end?: boolean }
  | { kind: "soon"; label: string; icon: typeof LayoutDashboard };

const SECTIONS: { title: string; items: NavEntry[] }[] = [
  {
    title: "",
    items: [{ kind: "link", to: "/backoffice/superadmin", label: "Tableau de bord", icon: LayoutDashboard, end: true }],
  },
  {
    title: "Gestion",
    items: [
      { kind: "link", to: "/backoffice/superadmin/terrains", label: "Terrains", icon: Map },
      { kind: "link", to: "/backoffice/superadmin/utilisateurs", label: "Utilisateurs", icon: Users },
      { kind: "link", to: "/backoffice/superadmin/abonnements", label: "Abonnements", icon: CreditCard },
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
    title: "Plateforme",
    items: [
      { kind: "link", to: "/backoffice/superadmin/commodites", label: "Commodités", icon: Sparkles },
      { kind: "link", to: "/backoffice/superadmin/audit", label: "Audit", icon: ClipboardList },
      { kind: "link", to: "/backoffice/superadmin/whatsapp", label: "Paramètres", icon: MessageCircle },
    ],
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
      className="sa-sidebar flex flex-col h-full shrink-0 overflow-x-hidden overflow-y-auto"
      style={{
        width: "var(--sa-sidebar-width)",
        minWidth: "var(--sa-sidebar-width)",
        background: "var(--sa-sidebar-bg)",
        boxShadow: "1px 0 0 rgba(255,255,255,0.04)",
      }}
    >
      <div className="h-14 px-4 flex items-center gap-2 min-w-0" style={{ borderBottom: "1px solid var(--sa-sidebar-border)" }}>
        <CircleDot size={18} className="shrink-0" style={{ color: "var(--sa-sidebar-logo)" }} />
        <p className="text-[15px] font-black tracking-tight truncate min-w-0" style={{ fontFamily: "var(--sa-font-display)", color: "var(--sa-sidebar-logo)" }}>
          TerrainSN
        </p>
        <span className="ml-auto shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: "var(--sa-sidebar-active-bg)", color: "var(--sa-sidebar-active-text)" }}>
          Admin
        </span>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-4">
        {SECTIONS.map((section) => (
          <div key={section.title}>
            {section.title ? (
            <p
              className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-wider"
              style={{ color: "var(--sa-sidebar-section)" }}
            >
              {section.title}
            </p>
            ) : null}
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
                      `flex items-center gap-2.5 mx-1 px-3 py-2 rounded-md text-[13px] font-medium leading-snug ${
                        isActive ? "" : ""
                      }`
                    }
                    style={({ isActive }) =>
                      isActive
                        ? {
                            background: "var(--sa-sidebar-active-bg)",
                            color: "var(--sa-sidebar-active-text)",
                            boxShadow: "inset 3px 0 0 var(--sa-sidebar-active-border)",
                          }
                        : { color: "var(--sa-sidebar-text)" }
                    }
                    onMouseEnter={(e) => {
                      if (e.currentTarget.getAttribute("aria-current") !== "page") {
                        e.currentTarget.style.background = "rgba(255,255,255,0.06)";
                        e.currentTarget.style.color = "var(--sa-sidebar-text-hover)";
                      }
                    }}
                    onMouseLeave={(e) => {
                      const active = e.currentTarget.getAttribute("aria-current") === "page";
                      if (!active) {
                        e.currentTarget.style.background = "transparent";
                        e.currentTarget.style.color = "var(--sa-sidebar-text)";
                        e.currentTarget.style.boxShadow = "none";
                      }
                    }}
                  >
                    <item.icon size={15} className="shrink-0" />
                    <span className="min-w-0 flex-1 whitespace-normal break-words">{item.label}</span>
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
            style={{ background: "var(--sa-sidebar-active-bg)", color: "var(--sa-sidebar-active-text)" }}
          >
            {user?.photo_url ? (
              <img src={user.photo_url} alt="" className="w-full h-full object-cover rounded-full" />
            ) : (
              initials(user)
            )}
          </span>
          <span className="min-w-0">
            <span className="block text-[12px] font-semibold truncate" style={{ color: "var(--sa-sidebar-logo)" }}>
              {displayName(user)}
            </span>
            <span className="block text-[10px]" style={{ color: "var(--sa-sidebar-text)" }}>
              Super Admin
            </span>
          </span>
        </button>
        <div className="mt-1 flex items-center gap-1 px-2">
          <button
            type="button"
            onClick={() => logout()}
            className="flex-1 inline-flex items-center justify-center gap-2 h-9 rounded-lg text-[12px]"
            style={{ color: "var(--sa-sidebar-text)" }}
            title="Déconnexion"
          >
            <LogOut size={15} />
          </button>
          <a
            href="/joueur"
            target="_blank"
            rel="noreferrer"
            className="flex-1 inline-flex items-center justify-center h-9 rounded-lg"
            style={{ color: "var(--sa-sidebar-text)" }}
            title="Voir l'app"
          >
            <ExternalLink size={15} />
          </a>
        </div>
      </div>
    </aside>
  );
}

export default function SuperadminLayout() {
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [crumbs, setCrumbs] = useState<SaCrumb[]>([]);
  const [alertCount, setAlertCount] = useState(0);
  const { down: waDown } = useWhatsappInfra(true);

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
        <div
          className="hidden md:flex fixed inset-y-0 left-0 z-40"
          style={{ width: "var(--sa-sidebar-width)", minWidth: "var(--sa-sidebar-width)" }}
        >
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

        <div className="sa-shell-main min-h-screen flex flex-col">
          <header
            className="sticky top-0 z-30 flex items-center justify-between gap-3 px-5 md:px-8"
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
              <nav className="flex items-center gap-1 text-[13px] overflow-x-auto scrollbar-hide" style={{ color: "var(--sa-text-3)" }}>
                {shown.map((c, i) => (
                  <span key={`${c.label}-${i}`} className="flex items-center gap-1 shrink-0">
                    {i > 0 ? <span style={{ color: "var(--sa-text-muted)" }}>/</span> : null}
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
              <span className="hidden sm:inline-flex items-center gap-1.5 text-[12px]" style={{ color: "var(--sa-text-3)" }}>
                <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: waDown ? "var(--sa-danger)" : "var(--sa-success)" }} />
                {waDown ? "Hors ligne" : "Live"}
              </span>
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
                href="/joueur"
                target="_blank"
                rel="noreferrer"
                className="hidden sm:inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-[12px] font-semibold"
                style={{ border: "1px solid var(--sa-border)", color: "var(--sa-text-2)", background: "var(--sa-surface)" }}
              >
                <ExternalLink size={13} />
                Voir l&apos;app
              </a>
            </div>
          </header>
          <WhatsAppInfraBanner visible={waDown} tone="superadmin" />
          <main className="flex-1 min-w-0 px-5 py-6 md:px-8 md:py-8">
            <div className="max-w-[1280px] mx-auto w-full min-w-0">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </SaHeaderContext.Provider>
  );
}
