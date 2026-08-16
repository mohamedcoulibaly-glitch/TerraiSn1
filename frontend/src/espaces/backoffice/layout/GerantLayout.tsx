import { CalendarDays, Users, Wallet, Settings } from "lucide-react";
import { NavLink, Outlet, useLocation } from "react-router-dom";

const TABS = [
  {
    id: "planning",
    label: "Accueil",
    icon: CalendarDays,
    route: "/backoffice/gerant",
    end: true,
  },
  {
    id: "joueurs",
    label: "Joueurs",
    icon: Users,
    route: "/backoffice/gerant/joueurs",
  },
  {
    id: "finances",
    label: "Finances",
    icon: Wallet,
    route: "/backoffice/gerant/finances",
  },
  {
    id: "parametres",
    label: "Paramètres",
    icon: Settings,
    route: "/backoffice/gerant/parametres",
  },
] as const;

function resolveOnglet(pathname: string): (typeof TABS)[number]["id"] {
  if (pathname.startsWith("/backoffice/gerant/parametres")) return "parametres";
  if (
    pathname.startsWith("/backoffice/gerant/finances") ||
    pathname.startsWith("/backoffice/gerant/portefeuille") ||
    pathname.startsWith("/backoffice/gerant/tarifs")
  ) {
    return "finances";
  }
  if (
    pathname.startsWith("/backoffice/gerant/joueurs") ||
    pathname.startsWith("/backoffice/gerant/reservations")
  ) {
    return "joueurs";
  }
  return "planning";
}

export default function GerantLayout() {
  const location = useLocation();
  const ongletActif = resolveOnglet(location.pathname);

  return (
    <div className="gerant-app min-h-screen pb-20 md:pb-0" style={{ background: "var(--g-bg)" }}>
      <main className="max-w-lg mx-auto md:max-w-3xl md:ml-56 md:mr-auto md:px-6">
        <Outlet />
      </main>

      {/* Bottom tab bar mobile */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-50 safe-bottom md:hidden"
        style={{
          background: "var(--g-nav-bg)",
          borderTop: "1px solid var(--g-nav-border)",
          backdropFilter: "blur(12px)",
        }}
      >
        <div className="flex items-center justify-around px-2 py-2">
          {TABS.map(({ id, label, icon: Icon, route, end }) => {
            const actif = ongletActif === id;
            return (
              <NavLink
                key={id}
                to={route}
                end={Boolean(end)}
                className="flex flex-col items-center gap-1 px-4 py-1.5 rounded-xl transition-all btn-press min-h-[44px] justify-center"
                style={{
                  color: actif ? "var(--g-primary)" : "var(--g-muted)",
                  background: actif ? "var(--g-primary-glow)" : "transparent",
                }}
              >
                <Icon className="w-5 h-5" />
                <span className="text-[10px] font-semibold">{label}</span>
                {actif && (
                  <span
                    className="w-1 h-1 rounded-full pulse-dot"
                    style={{ background: "var(--g-primary)" }}
                  />
                )}
              </NavLink>
            );
          })}
        </div>
      </nav>

      {/* Sidebar desktop */}
      <aside
        className="hidden md:flex fixed left-0 top-0 bottom-0 w-56 flex-col py-8 px-4 z-40"
        style={{
          background: "var(--g-surface)",
          borderRight: "1px solid var(--g-border)",
          boxShadow: "var(--g-shadow-md)",
        }}
      >
        <span className="text-lg font-black px-2 mb-8" style={{ color: "var(--g-text)" }}>
          TERRAIN<span style={{ color: "var(--g-primary)" }}>.SN</span>
        </span>
        {TABS.map(({ id, label, icon: Icon, route, end }) => {
          const actif = ongletActif === id;
          return (
            <NavLink
              key={id}
              to={route}
              end={Boolean(end)}
              className="flex items-center gap-3 px-3 py-3 rounded-xl mb-1 font-semibold text-sm text-left transition-all min-h-[44px]"
              style={{
                color: actif ? "var(--g-primary)" : "var(--g-text-2)",
                background: actif ? "var(--g-primary-glow)" : "transparent",
                borderLeft: actif ? "3px solid var(--g-primary)" : "3px solid transparent",
              }}
            >
              <Icon className="w-5 h-5 shrink-0" />
              {label}
            </NavLink>
          );
        })}
      </aside>
    </div>
  );
}
