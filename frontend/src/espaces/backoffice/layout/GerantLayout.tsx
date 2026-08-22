import { CalendarDays, Settings, Users, Wallet } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { profileForUser } from "@/auth/roles";
import { useAuth } from "@/hooks/use-auth";
import { gerantApi, getGerantTerrainActif, setGerantTerrainActif } from "@/lib/api";
import { useWhatsappInfra } from "@/hooks/useWhatsappInfra";
import WhatsAppInfraBanner from "@/espaces/backoffice/components/WhatsAppInfraBanner";

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

type HeaderUser = { prenom?: string; nom?: string; photo_url?: string } | null;
type TerrainOption = { id: number; nom: string; est_principal?: number };

function initials(user: HeaderUser) {
  const p = (user?.prenom || "").trim();
  const n = (user?.nom || "").trim();
  return `${p.charAt(0)}${n.charAt(0)}`.toUpperCase() || "G";
}

function firstName(user: HeaderUser) {
  if (user?.prenom?.trim()) return user.prenom.trim();
  if (user?.nom?.trim()) return user.nom.trim().split(" ")[0];
  return "Gérant";
}

function resolveOnglet(pathname: string): (typeof TABS)[number]["id"] {
  if (pathname.startsWith("/backoffice/gerant/parametres") || pathname.startsWith("/backoffice/gerant/tarifs")) {
    return "parametres";
  }
  if (
    pathname.startsWith("/backoffice/gerant/finances") ||
    pathname.startsWith("/backoffice/gerant/portefeuille")
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

function HeaderAvatar({ user }: { user: HeaderUser }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => navigate(profileForUser(user))}
      className="inline-flex items-center justify-center w-9 h-9 rounded-full overflow-hidden shrink-0"
      style={{ border: "2px solid var(--g-primary)", background: "var(--g-primary-glow)", color: "var(--g-primary)" }}
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

export default function GerantLayout() {
  const { user } = useAuth();
  const location = useLocation();
  const ongletActif = resolveOnglet(location.pathname);
  const [terrains, setTerrains] = useState<TerrainOption[]>([]);
  const [terrainActif, setTerrainActifState] = useState<number | null>(getGerantTerrainActif());
  const [terrainNom, setTerrainNom] = useState("");
  const { down: waDown } = useWhatsappInfra(true);

  const applyTerrain = useCallback((id: number, list?: TerrainOption[]) => {
    setGerantTerrainActif(id);
    setTerrainActifState(id);
    const source = list || terrains;
    const found = source.find((t) => Number(t.id) === Number(id));
    setTerrainNom(found?.nom || "");
  }, [terrains]);

  useEffect(() => {
    let cancelled = false;
    gerantApi
      .terrains()
      .then((payload) => {
        if (cancelled) return;
        const list = Array.isArray(payload?.terrains) ? payload.terrains : [];
        setTerrains(list);
        const saved = getGerantTerrainActif();
        const ids = list.map((t) => Number(t.id));
        const initial =
          (saved && ids.includes(saved) ? saved : null)
          || (payload.terrain_actif && ids.includes(Number(payload.terrain_actif))
            ? Number(payload.terrain_actif)
            : null)
          || ids[0]
          || null;
        if (initial) {
          setGerantTerrainActif(initial);
          setTerrainActifState(initial);
          setTerrainNom(list.find((t) => Number(t.id) === initial)?.nom || "");
        }
      })
      .catch(() => {
        gerantApi
          .dashboard()
          .then((payload) => {
            const nom = (payload as { terrain?: { nom?: string } } | null)?.terrain?.nom;
            if (!cancelled) setTerrainNom(nom || "");
          })
          .catch(() => undefined);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Heartbeat toutes les 30s
  useEffect(() => {
    if (!terrainActif) return;
    const tick = () => {
      gerantApi.heartbeat(terrainActif).catch(() => undefined);
    };
    tick();
    const id = window.setInterval(tick, 30000);
    return () => window.clearInterval(id);
  }, [terrainActif]);

  const greeting = `Bonjour ${firstName(user)} 👋`;
  const subtitle = terrainNom || "Espace gérant";
  const multi = terrains.length > 1;

  const Sidebar = (
    <aside
      className="flex flex-col w-[220px] min-h-full shrink-0"
      style={{ background: "var(--g-surface)", borderRight: "1px solid var(--g-border)" }}
    >
      <div className="px-5 py-6" style={{ borderBottom: "1px solid var(--g-border)" }}>
        <p className="text-[15px] font-semibold tracking-tight" style={{ fontFamily: "var(--font-display)", color: "var(--g-text)" }}>
          TerrainSN
        </p>
        <p className="text-[11px] mt-1" style={{ color: "var(--g-muted)" }}>
          Espace gérant
        </p>
        {multi ? (
          <select
            value={terrainActif ?? ""}
            onChange={(e) => applyTerrain(Number(e.target.value))}
            className="mt-3 w-full text-sm font-semibold rounded-lg px-2 py-1.5 border"
            style={{
              background: "var(--g-surface)",
              borderColor: "var(--g-border)",
              color: "var(--g-text)",
            }}
            aria-label="Terrain actif"
          >
            {terrains.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nom}
              </option>
            ))}
          </select>
        ) : null}
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1">
        {TABS.map((tab) => {
          const active = ongletActif === tab.id;
          return (
            <NavLink
              key={tab.id}
              to={tab.route}
              end={Boolean(tab.end)}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium min-h-[44px]"
              style={{
                background: active ? "var(--g-primary-glow)" : "transparent",
                color: active ? "var(--g-nav-active)" : "var(--g-muted)",
                borderLeft: active ? "3px solid var(--g-nav-active)" : "3px solid transparent",
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
    <div className="gerant-app flex min-h-screen" style={{ background: "var(--g-bg)" }}>
      <div className="hidden md:flex sticky top-0 h-screen">{Sidebar}</div>

      <div className="flex-1 flex flex-col min-w-0 pb-[calc(56px+env(safe-area-inset-bottom))] md:pb-0">
        <header
          className="sticky top-0 z-30 h-14 px-4 flex items-center justify-between gap-3"
          style={{ background: "var(--g-surface)", borderBottom: "1px solid var(--g-border)" }}
        >
          <div className="min-w-0 flex-1">
            <p className="font-bold text-[16px] truncate leading-tight" style={{ color: "var(--g-text)" }}>
              {greeting}
            </p>
            {multi ? (
              <select
                value={terrainActif ?? ""}
                onChange={(e) => applyTerrain(Number(e.target.value))}
                className="mt-0.5 text-sm font-semibold rounded-lg px-2 py-0.5 border max-w-full"
                style={{
                  background: "var(--g-surface)",
                  borderColor: "var(--g-border)",
                  color: "var(--g-text)",
                }}
                aria-label="Terrain actif"
              >
                {terrains.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nom}
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-[12px] truncate" style={{ color: "var(--g-muted)" }}>
                {subtitle}
              </p>
            )}
          </div>
          <HeaderAvatar user={user} />
        </header>

        <WhatsAppInfraBanner visible={waDown} tone="gerant" />

        <main className="flex-1 p-3 md:p-6 overflow-auto">
          <div className="max-w-5xl mx-auto" key={terrainActif ?? "default"}>
            <Outlet context={{ terrainActif, terrains }} />
          </div>
        </main>
      </div>

      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-40 pb-[env(safe-area-inset-bottom)]"
        style={{ background: "var(--g-nav-bg)", borderTop: "1px solid var(--g-nav-border)" }}
      >
        <div className="grid grid-cols-4 max-w-lg mx-auto">
          {TABS.map((tab) => {
            const active = ongletActif === tab.id;
            return (
              <NavLink
                key={tab.id}
                to={tab.route}
                end={Boolean(tab.end)}
                className="flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-[11px] font-medium"
                style={{ color: active ? "var(--g-nav-active)" : "var(--g-muted)" }}
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
