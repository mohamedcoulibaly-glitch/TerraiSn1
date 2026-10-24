import { CalendarDays, CheckCircle, ChevronDown, MapPin, QrCode, Settings, Users, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { profileForUser } from "@/auth/roles";
import { useAuth } from "@/hooks/use-auth";
import { useTerrainActif } from "@/hooks/useTerrainActif";
import { gerantApi } from "@/lib/api";
import { useWhatsappInfra } from "@/hooks/useWhatsappInfra";
import WhatsAppInfraBanner from "@/espaces/backoffice/components/WhatsAppInfraBanner";
import WhatsAppGerantSessionBanner from "@/espaces/backoffice/components/WhatsAppGerantSessionBanner";
import { BottomSheet } from "@/components/BottomSheet";
import { hapticSelection } from "@/lib/haptics";

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
    label: "Réservation",
    icon: Users,
    route: "/backoffice/gerant/joueurs",
    end: false,
  },
  {
    id: "finances",
    label: "Finances",
    icon: Wallet,
    route: "/backoffice/gerant/finances",
    end: false,
  },
  {
    id: "parametres",
    label: "Paramètres",
    icon: Settings,
    route: "/backoffice/gerant/parametres",
    end: false,
  },
] as const;

type HeaderUser = {
  prenom?: string;
  nom?: string;
  photo_url?: string;
  role?: string;
  accountType?: string;
} | null;

function initials(user: HeaderUser) {
  const p = (user?.prenom || "").trim();
  const n = (user?.nom || "").trim();
  return `${p.charAt(0)}${n.charAt(0)}`.toUpperCase() || "G";
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
    pathname.startsWith("/backoffice/gerant/reservations") ||
    pathname.startsWith("/backoffice/gerant/historique")
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
      className="inline-flex items-center justify-center w-8 h-8 rounded-full overflow-hidden shrink-0 btn-press"
      style={{ border: "2px solid var(--g-primary)", background: "var(--g-primary-glow)", color: "var(--g-primary)" }}
      aria-label="Profil"
    >
      {user?.photo_url ? (
        <img src={user.photo_url} alt="" className="w-full h-full object-cover" />
      ) : (
        <span className="text-[10px] font-semibold">{initials(user)}</span>
      )}
    </button>
  );
}

function HeureLive() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const label = now.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return (
    <time
      dateTime={now.toISOString()}
      className="text-sm font-semibold tabular-nums"
      style={{ color: "var(--g-text-2)", fontFamily: "var(--font-display)" }}
    >
      {label}
    </time>
  );
}

function BoutonScannerUrgent({ count }: { count: number }) {
  const navigate = useNavigate();
  if (count <= 0) return null;
  return (
    <button
      type="button"
      onClick={() => navigate("/backoffice/gerant#scanner")}
      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold text-white btn-press animate-pulse"
      style={{ background: "var(--g-primary)", boxShadow: "0 0 0 2px var(--g-primary-glow)" }}
      aria-label={`Scanner — ${count} match imminent`}
    >
      <QrCode className="w-4 h-4" />
      <span>⚡ {count}</span>
    </button>
  );
}

export default function GerantLayout() {
  const { user } = useAuth();
  const location = useLocation();
  const ongletActif = resolveOnglet(location.pathname);
  const { terrains, terrainActif, setTerrainActif } = useTerrainActif();
  const [showTerrainPicker, setShowTerrainPicker] = useState(false);
  const { down: waDown } = useWhatsappInfra(true);

  const terrainActifId = terrainActif?.id ?? null;
  const multi = terrains.length > 1;
  const matchImminent = Number(terrainActif?.imminent_count) > 0;

  // Heartbeat toutes les 30s
  useEffect(() => {
    if (!terrainActifId) return;
    const tick = () => {
      gerantApi.heartbeat(terrainActifId).catch(() => undefined);
    };
    tick();
    const id = window.setInterval(tick, 30000);
    return () => window.clearInterval(id);
  }, [terrainActifId]);

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
          <button
            type="button"
            onClick={() => setShowTerrainPicker(true)}
            className="mt-3 w-full flex items-center gap-1.5 px-3 py-2 rounded-xl btn-press text-left"
            style={{ background: "var(--g-surface-2)", border: "1px solid var(--g-border)" }}
          >
            <div className="w-2 h-2 rounded-full animate-pulse shrink-0" style={{ background: "var(--g-primary)" }} />
            <span className="text-sm font-semibold truncate flex-1" style={{ color: "var(--g-text)" }}>
              {terrainActif?.nom || "Choisir"}
            </span>
            <ChevronDown className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--g-muted)" }} />
          </button>
        ) : (
          <p className="mt-3 text-sm font-semibold truncate" style={{ color: "var(--g-text)" }}>
            {terrainActif?.nom || "—"}
          </p>
        )}
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
          className="sticky top-0 z-40 pt-[env(safe-area-inset-top)]"
          style={{ height: "auto", background: "var(--g-surface)", borderBottom: "1px solid var(--g-border)" }}
        >
          <div className="h-14 px-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <HeaderAvatar user={user} />

              {multi ? (
                <button
                  type="button"
                  onClick={() => setShowTerrainPicker(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl btn-press min-w-0"
                  style={{ background: "var(--g-surface-2)", border: "1px solid var(--g-border)" }}
                  aria-label="Changer de terrain"
                >
                  <div className="w-2 h-2 rounded-full animate-pulse shrink-0" style={{ background: "var(--g-primary)" }} />
                  <span className="text-sm font-semibold max-w-[120px] truncate" style={{ color: "var(--g-text)" }}>
                    {terrainActif?.nom || "Terrain"}
                  </span>
                  <ChevronDown className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--g-muted)" }} />
                </button>
              ) : (
                <span className="text-sm font-semibold truncate" style={{ color: "var(--g-text)" }}>
                  {terrainActif?.nom}
                </span>
              )}
            </div>

            <div className="flex items-center gap-3 shrink-0">
              <HeureLive />
              {matchImminent && (
                <BoutonScannerUrgent count={Number(terrainActif?.imminent_count) || 0} />
              )}
            </div>
          </div>
        </header>

        <WhatsAppInfraBanner visible={waDown} tone="gerant" />
        <WhatsAppGerantSessionBanner />

        <main className="flex-1 p-3 md:p-6 overflow-auto">
          <div className="max-w-5xl mx-auto" key={terrainActifId ?? "default"}>
            <Outlet context={{ terrainActif: terrainActifId, terrains, terrain: terrainActif, setTerrainActif }} />
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
                onClick={() => hapticSelection()}
                className="flex min-h-[56px] flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-[transform,opacity] duration-150 active:scale-95"
                style={{ color: active ? "var(--g-nav-active)" : "var(--g-muted)" }}
              >
                <tab.icon className="w-5 h-5" />
                {tab.label}
              </NavLink>
            );
          })}
        </div>
      </nav>

      <BottomSheet
        ouvert={showTerrainPicker}
        onFermer={() => setShowTerrainPicker(false)}
        titre="Choisir un terrain"
      >
        <div className="flex flex-col gap-2 pb-4">
          {terrains.map((terrain) => {
            const actif = terrainActif != null && Number(terrain.id) === Number(terrainActif.id);
            return (
              <button
                key={terrain.id}
                type="button"
                onClick={() => {
                  setTerrainActif(terrain);
                  setShowTerrainPicker(false);
                  hapticSelection();
                }}
                className="flex items-center gap-3 p-4 rounded-xl text-left btn-press"
                style={{
                  background: actif ? "var(--g-primary-glow)" : "var(--g-surface-2)",
                  border: `1px solid ${actif ? "var(--g-primary)" : "var(--g-border)"}`,
                }}
              >
                <div
                  className="w-12 h-12 rounded-lg overflow-hidden shrink-0 flex items-center justify-center"
                  style={{ background: "var(--g-surface-3)" }}
                >
                  {terrain.photo_principale ? (
                    <img
                      src={terrain.photo_principale}
                      alt={terrain.nom}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <MapPin className="w-5 h-5" style={{ color: "var(--g-muted)" }} />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm truncate" style={{ color: "var(--g-text)" }}>
                    {terrain.nom}
                  </p>
                  {terrain.quartier ? (
                    <p className="text-xs truncate" style={{ color: "var(--g-muted)" }}>
                      {terrain.quartier}
                    </p>
                  ) : null}
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <span className="text-xs" style={{ color: "var(--g-primary)" }}>
                      {Number(terrain.matchs_aujourd_hui) || 0} match(s) aujourd&apos;hui
                    </span>
                    {Number(terrain.imminent_count) > 0 ? (
                      <span
                        className="text-xs px-1.5 py-0.5 rounded-full"
                        style={{ background: "var(--g-warning-bg)", color: "var(--g-warning)" }}
                      >
                        ⚡ {terrain.imminent_count} imminent(s)
                      </span>
                    ) : null}
                  </div>
                </div>

                {actif ? (
                  <CheckCircle className="w-5 h-5 shrink-0" style={{ color: "var(--g-primary)" }} />
                ) : null}
              </button>
            );
          })}
        </div>
      </BottomSheet>
    </div>
  );
}
