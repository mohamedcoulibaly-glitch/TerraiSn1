import {
  Banknote,
  CalendarDays,
  Clock,
  Lock,
  PlusCircle,
  QrCode,
  User,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { normalizeRole, profileForUser } from "@/auth/roles";
import { useAuth } from "@/hooks/use-auth";
import { gerantApi, terrainsApi } from "@/lib/api";
import {
  calculerFenetreCheckIn,
  calculerFlagsMatch,
  estImminente,
} from "@/lib/checkInFenetre";
import { localYmd } from "@/lib/localDate";
import BloquerCreneauModal from "@/espaces/backoffice/components/BloquerCreneauModal";
import ReservationExpressModal from "@/espaces/backoffice/components/ReservationExpressModal";
import ScannerModal from "@/espaces/backoffice/components/ScannerModal";
import ValidationManuelleModal from "@/espaces/backoffice/components/ValidationManuelleModal";

type TodayReservation = {
  id: number;
  code_reservation?: string | null;
  joueur_nom?: string | null;
  joueur_telephone?: string | null;
  date?: string;
  heure_debut: string;
  heure_fin: string;
  statut: string;
  qr_code_scanne_at?: string | null;
  fenetre_retard?: number | null;
  montant_avance?: number;
  montant_restant?: number;
  montant?: number;
  prix_total?: number;
  terrain_id?: number | null;
  creneau_id?: number | null;
  /** Présent si card issue d'un blocage (Workflow 6) */
  blocage_id?: number;
  motif?: string | null;
};

type MatchStatus = "libre" | "reserve" | "en_cours" | "termine" | "bloque";

function timeToMinutes(value: string) {
  const [h, m] = String(value || "0:0")
    .slice(0, 5)
    .split(":")
    .map(Number);
  return h * 60 + (m || 0);
}

function formatHourRange(debut: string, fin: string) {
  const d = String(debut).slice(0, 5).replace(":", "h");
  const f = String(fin).slice(0, 5).replace(":", "h");
  return `${d} → ${f}`;
}

function toCreneau(resa: TodayReservation, dayDate: string) {
  return {
    date: resa.date || dayDate,
    heure_debut: resa.heure_debut,
    heure_fin: resa.heure_fin,
    fenetre_retard: resa.fenetre_retard,
  };
}

/**
 * Statut d'affichage de la card — calculé côté front selon l'heure courante (Workflow 1 + 7).
 */
function resolveLiveStatus(resa: TodayReservation, dayDate: string, nowMs: number): MatchStatus {
  if (resa.statut === "libre") return "libre";
  if (resa.statut === "bloque" || resa.statut === "blocked") return "bloque";

  const creneau = toCreneau(resa, dayDate);
  const flags = calculerFlagsMatch(creneau, resa.statut, nowMs);
  const scanned =
    Boolean(resa.qr_code_scanne_at) || ["match_joue", "joue"].includes(String(resa.statut || ""));

  // Workflow 7 : après scan → En cours jusqu'à fin+retard, puis Terminé
  if (scanned) {
    const { heureFinMs, retardMin } = calculerFenetreCheckIn(creneau);
    if (nowMs > heureFinMs + retardMin * 60 * 1000 || flags.estTerminee) return "termine";
    return "en_cours";
  }

  if (flags.estEnCours && ["confirme", "acceptee"].includes(resa.statut)) {
    return "en_cours";
  }
  if (["confirme", "acceptee", "en_attente"].includes(resa.statut)) return "reserve";
  return "libre";
}

const STATUS_UI: Record<
  MatchStatus,
  { label: string; color: string; bg: string }
> = {
  libre: { label: "Libre", color: "var(--g-libre)", bg: "var(--g-libre-bg)" },
  reserve: { label: "Réservé ✓", color: "var(--g-reserve)", bg: "var(--g-reserve-bg)" },
  en_cours: { label: "En cours ⚽", color: "var(--g-en-cours)", bg: "var(--g-en-cours-bg)" },
  termine: { label: "Terminé ✓", color: "var(--g-termine)", bg: "var(--g-termine-bg)" },
  bloque: { label: "Bloqué 🔒", color: "var(--g-bloque)", bg: "var(--g-bloque-bg)" },
};

const MOTIF_LABEL: Record<string, string> = {
  pluie: "Pluie",
  maintenance: "Maintenance",
  match_prive: "Match privé",
  autre: "Autre",
};

function initials(user: { prenom?: string; nom?: string } | null) {
  const p = (user?.prenom || "").trim();
  const n = (user?.nom || "").trim();
  return `${p.charAt(0)}${n.charAt(0)}`.toUpperCase() || "G";
}

const ManagerDashboard = () => {
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();
  const [dashboard, setDashboard] = useState<any>(null);
  const [todayPayload, setTodayPayload] = useState<{
    date: string;
    reservations: TodayReservation[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [vue, setVue] = useState<"jour" | "semaine">("jour");
  const [selectedDay, setSelectedDay] = useState(localYmd());
  const [expressOpen, setExpressOpen] = useState(false);
  const [expressPrefill, setExpressPrefill] = useState<{
    date?: string;
    heure_debut?: string;
    heure_fin?: string;
  } | null>(null);
  const [blockOpen, setBlockOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanTarget, setScanTarget] = useState<TodayReservation | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  /** Horloge locale pour recalculer les flags sans attendre un refresh API. */
  const [nowMs, setNowMs] = useState(() => Date.now());

  const [freeSlots, setFreeSlots] = useState<
    { heure_debut: string; heure_fin: string; disponible?: boolean }[]
  >([]);

  const loadDashboard = async () => {
    try {
      const data = await gerantApi.dashboard();
      setDashboard(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const loadToday = async (date?: string) => {
    try {
      const data = (await gerantApi.reservationsToday(date)) as {
        date: string;
        reservations: TodayReservation[];
      };
      const sorted = [...(data.reservations || [])].sort(
        (a, b) => timeToMinutes(a.heure_debut) - timeToMinutes(b.heure_debut),
      );
      setTodayPayload({ date: data.date, reservations: sorted });
      if (data?.date) setSelectedDay(data.date);
    } catch (err) {
      console.error(err);
      setTodayPayload({ date: date || localYmd(), reservations: [] });
    }
  };

  const loadFreeSlots = async (terrainId?: number, date?: string) => {
    if (!terrainId || !date) {
      setFreeSlots([]);
      return;
    }
    try {
      const data = (await terrainsApi.getCreneaux(terrainId, date)) as {
        creneaux?: { heure?: string; heure_debut?: string; heure_fin?: string; disponible?: boolean; statut?: string }[];
      };
      const libres = (data?.creneaux || [])
        .filter((c) => c.disponible !== false && c.statut !== "occupe" && c.statut !== "bloque")
        .map((c) => {
          const debut = String(c.heure_debut || c.heure || "").slice(0, 5);
          const fin = String(c.heure_fin || "").slice(0, 5) || (() => {
            const h = parseInt(debut.split(":")[0], 10);
            return `${String(h + 1).padStart(2, "0")}:00`;
          })();
          return { heure_debut: debut, heure_fin: fin, disponible: true };
        })
        .filter((c) => c.heure_debut);
      setFreeSlots(libres);
    } catch {
      setFreeSlots([]);
    }
  };

  useEffect(() => {
    if (!isAuthenticated || normalizeRole(user) !== "gerant") {
      navigate("/backoffice/login");
      return;
    }
    loadDashboard();
    loadToday();
  }, [isAuthenticated, user, navigate]);

  // Workflow 1 — file vivante : refresh API + horloge locale toutes les 60s
  useEffect(() => {
    if (!isAuthenticated || normalizeRole(user) !== "gerant") return;
    const tick = () => {
      setNowMs(Date.now());
      void loadToday(selectedDay);
    };
    const timer = window.setInterval(tick, 60_000);
    return () => window.clearInterval(timer);
  }, [isAuthenticated, user, selectedDay]);

  useEffect(() => {
    const terrainId = dashboard?.terrain?.id;
    const date = todayPayload?.date || selectedDay;
    if (terrainId && date) void loadFreeSlots(terrainId, date);
  }, [dashboard?.terrain?.id, todayPayload?.date, selectedDay]);

  const todayList = todayPayload?.reservations || [];
  const dayDate = todayPayload?.date || selectedDay || localYmd();

  const dayBlocages = useMemo(() => {
    const all = (dashboard?.blocages || []) as Array<{
      id: number;
      date: string;
      heure_debut: string;
      heure_fin: string;
      motif?: string | null;
    }>;
    return all.filter((b) => String(b.date).slice(0, 10) === dayDate);
  }, [dashboard?.blocages, dayDate]);

  /** File d'attente : résas + libres + bloqués (Workflow 6). */
  const dayTimeline = useMemo(() => {
    const reservedHours = new Set(
      todayList.flatMap((r) => {
        const start = timeToMinutes(r.heure_debut);
        const end = timeToMinutes(r.heure_fin);
        const hours: string[] = [];
        for (let m = start; m < end; m += 60) {
          hours.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:00`);
        }
        return hours;
      }),
    );
    const blockedHours = new Set(
      dayBlocages.flatMap((b) => {
        const start = timeToMinutes(b.heure_debut);
        const end = timeToMinutes(b.heure_fin);
        const hours: string[] = [];
        for (let m = start; m < end; m += 60) {
          hours.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:00`);
        }
        return hours;
      }),
    );
    const libresAsCards: TodayReservation[] = freeSlots
      .filter((s) => {
        const h = String(s.heure_debut).slice(0, 5);
        return !reservedHours.has(h) && !blockedHours.has(h);
      })
      .map((s, idx) => ({
        id: -1000 - idx,
        heure_debut: s.heure_debut,
        heure_fin: s.heure_fin,
        statut: "libre",
        date: dayDate,
      }));
    const bloqueAsCards: TodayReservation[] = dayBlocages.map((b) => ({
      id: -2000 - b.id,
      blocage_id: b.id,
      heure_debut: String(b.heure_debut).slice(0, 5),
      heure_fin: String(b.heure_fin).slice(0, 5),
      statut: "bloque",
      motif: b.motif,
      date: dayDate,
    }));
    return [...todayList, ...libresAsCards, ...bloqueAsCards].sort(
      (a, b) => timeToMinutes(a.heure_debut) - timeToMinutes(b.heure_debut),
    );
  }, [todayList, freeSlots, dayDate, dayBlocages]);

  /** Résas confirmées imminentes (≤30 min), triées par début — Workflow 2 */
  const imminentes = useMemo(() => {
    return todayList
      .filter((r) => {
        if (r.statut !== "confirme" || r.qr_code_scanne_at) return false;
        return estImminente(toCreneau(r, dayDate), nowMs);
      })
      .sort((a, b) => timeToMinutes(a.heure_debut) - timeToMinutes(b.heure_debut));
  }, [todayList, dayDate, nowMs]);

  const prochaineImminente = imminentes[0] || null;

  const stats = useMemo(() => {
    const active = todayList.filter((r) =>
      ["confirme", "acceptee", "match_joue", "joue", "en_attente"].includes(r.statut),
    );
    const aEncaisser = todayList.reduce((sum, r) => {
      const reste = Number(r.montant_restant ?? 0);
      if (reste > 0 && ["confirme", "acceptee", "en_attente"].includes(r.statut)) {
        return sum + reste;
      }
      return sum;
    }, 0);
    return {
      matchs: todayList.length,
      aEncaisser,
      libres: freeSlots.length,
    };
  }, [todayList, freeSlots.length]);

  const weekDays = useMemo(() => {
    const base = new Date(`${localYmd()}T00:00:00`);
    const mondayOffset = (base.getDay() + 6) % 7;
    const monday = new Date(base);
    monday.setDate(base.getDate() - mondayOffset);
    const all = dashboard?.reservations || [];
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const ymd = localYmd(d);
      const count = all.filter(
        (r: any) =>
          r.date === ymd &&
          ["confirme", "acceptee", "en_attente", "match_joue", "joue"].includes(r.statut),
      ).length;
      return {
        ymd,
        label: d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric" }),
        count,
      };
    });
  }, [dashboard]);

  /** Bouton actions rapides : pré-sélectionne la plus proche, sinon Mode A (QR seul). */
  const openScannerQuick = () => {
    setScanTarget(prochaineImminente);
    setScannerOpen(true);
  };

  /** Depuis une card : Mode B avec réservation connue. */
  const openScanner = (resa: TodayReservation) => {
    setScanTarget(resa);
    setScannerOpen(true);
  };

  const openExpress = (prefill?: { date?: string; heure_debut?: string; heure_fin?: string } | null) => {
    setExpressPrefill(prefill || null);
    setExpressOpen(true);
  };

  /** Workflow 7 — maj immédiate de la card sans recharger (le refresh 60s confirme). */
  const applyOptimisticScan = (reservation: {
    id?: number;
    joueur_nom?: string;
    qr_code_scanne_at?: string;
    montant_restant?: number;
    heure_debut?: string;
    heure_fin?: string;
  }) => {
    const id = Number(reservation?.id);
    if (!Number.isFinite(id) || id < 1) return;

    setTodayPayload((prev) => {
      if (!prev) return prev;
      let found = false;
      const reservations = prev.reservations.map((r) => {
        if (r.id !== id) return r;
        found = true;
        return {
          ...r,
          statut: "match_joue",
          qr_code_scanne_at: reservation.qr_code_scanne_at || new Date().toISOString(),
          joueur_nom: reservation.joueur_nom || r.joueur_nom,
          // Solde affiché pour le badge « Encaisse X » (valeur renvoyée au scan)
          montant_restant:
            reservation.montant_restant != null
              ? Number(reservation.montant_restant)
              : Number(r.montant_restant ?? 0),
        };
      });
      if (!found) return prev;
      return { ...prev, reservations };
    });
  };

  const handleUnblockCreneau = async (blocageId?: number) => {
    if (!blocageId) return;
    try {
      await gerantApi.removeBlocage(blocageId);
      toast.success("Créneau débloqué");
      await loadDashboard();
      await loadFreeSlots(dashboard?.terrain?.id, dayDate);
    } catch (err: any) {
      toast.error(err?.message || "Déblocage impossible");
    }
  };

  if (loading) {
    return (
      <div className="animate-pulse space-y-4 p-4">
        <div className="h-14 rounded-xl" style={{ background: "var(--g-surface-2)" }} />
        <div className="grid grid-cols-3 gap-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-[52px] rounded-xl" style={{ background: "var(--g-surface-2)" }} />
          ))}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 rounded-xl" style={{ background: "var(--g-surface-2)" }} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="pb-6">
      {/* HEADER FIXE */}
      <header
        className="sticky top-0 z-20 px-4 py-3 flex items-center justify-between gap-3"
        style={{
          background: "var(--g-surface)",
          borderBottom: "1px solid var(--g-border)",
        }}
      >
        <div className="min-w-0">
          <p className="text-base font-bold truncate" style={{ color: "var(--g-text)" }}>
            Bonjour {(user?.prenom || user?.nom || "Gérant").split(" ")[0]} 👋
          </p>
          <p className="text-xs truncate" style={{ color: "var(--g-muted)" }}>
            {dashboard?.terrain?.nom || "Mon terrain"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate(profileForUser(user))}
          className="w-9 h-9 rounded-full overflow-hidden shrink-0 border"
          style={{ borderColor: "var(--g-border)", background: "var(--g-primary-glow)", color: "var(--g-primary)" }}
          aria-label="Profil"
        >
          {user?.photo_url ? (
            <img src={user.photo_url} alt="" className="w-full h-full object-cover" />
          ) : (
            <span className="text-xs font-semibold flex items-center justify-center w-full h-full">
              {initials(user)}
            </span>
          )}
        </button>
      </header>

      {/* ACTIONS RAPIDES */}
      <div className="px-4 pt-4 grid grid-cols-3 gap-2">
        <button
          type="button"
          onClick={() => openExpress(null)}
          className="h-[52px] rounded-xl text-white text-xs font-semibold inline-flex flex-col items-center justify-center gap-0.5 btn-press"
          style={{ background: "var(--g-primary)" }}
        >
          <PlusCircle className="w-5 h-5" />
          Nouvelle résa
        </button>
        <button
          type="button"
          onClick={openScannerQuick}
          className={`relative h-[52px] rounded-xl text-xs font-semibold inline-flex flex-col items-center justify-center gap-0.5 btn-press ${
            imminentes.length > 0 ? "animate-pulse" : ""
          }`}
          style={{
            background: imminentes.length > 0 ? "var(--g-primary)" : "var(--g-surface-2)",
            color: imminentes.length > 0 ? "#fff" : "var(--g-muted)",
            boxShadow: imminentes.length > 0 ? "0 0 0 2px var(--g-primary-glow)" : undefined,
          }}
          aria-label={
            imminentes.length > 0
              ? `Scanner — ${imminentes.length} match${imminentes.length > 1 ? "s" : ""} imminent${imminentes.length > 1 ? "s" : ""}`
              : "Scanner"
          }
        >
          <QrCode className={`w-5 h-5 ${imminentes.length > 0 ? "animate-pulse" : ""}`} />
          {imminentes.length > 0 ? `Scanner ⚡ (${imminentes.length})` : "Scanner"}
        </button>
        <button
          type="button"
          onClick={() => setBlockOpen(true)}
          className="h-[52px] rounded-xl text-xs font-semibold inline-flex flex-col items-center justify-center gap-0.5 btn-press"
          style={{ background: "var(--g-surface-2)", color: "var(--g-danger)" }}
        >
          <Lock className="w-5 h-5" />
          Bloquer
        </button>
      </div>

      {/* KPI */}
      <div className="px-4 pt-4 grid grid-cols-3 gap-2">
        {[
          {
            value: String(stats.matchs),
            label: "matchs prévus",
            icon: CalendarDays,
            color: "var(--g-primary)",
            valueColor: "var(--g-text)",
          },
          {
            value: stats.aEncaisser.toLocaleString("fr-FR"),
            label: "à encaisser",
            icon: Banknote,
            color: "var(--g-warning)",
            valueColor: "var(--g-warning)",
          },
          {
            value: String(stats.libres),
            label: "créneaux libres",
            icon: Clock,
            color: "var(--g-libre)",
            valueColor: "var(--g-libre)",
          },
        ].map((card) => (
          <div
            key={card.label}
            className="rounded-xl p-3 relative"
            style={{ background: "var(--g-surface)", boxShadow: "var(--g-shadow)" }}
          >
            <card.icon className="w-5 h-5 absolute top-3 right-3" style={{ color: card.color }} />
            <p
              className="text-2xl font-bold leading-none pr-6"
              style={{ fontFamily: "var(--font-display)", color: card.valueColor }}
            >
              {card.value}
            </p>
            <p className="text-[11px] mt-2" style={{ color: "var(--g-muted)" }}>
              {card.label}
            </p>
          </div>
        ))}
      </div>

      {/* TOGGLE */}
      <div className="px-4 pt-4 flex gap-2">
        {(
          [
            { id: "jour" as const, label: "Aujourd'hui" },
            { id: "semaine" as const, label: "Cette semaine" },
          ] as const
        ).map((t) => {
          const actif = vue === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setVue(t.id)}
              className="flex-1 min-h-[44px] rounded-full text-sm font-semibold"
              style={{
                background: actif ? "var(--g-primary)" : "var(--g-surface-2)",
                color: actif ? "#fff" : "var(--g-muted)",
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {vue === "semaine" && (
        <div className="px-4 pt-3 flex gap-2 overflow-x-auto scrollbar-none">
          {weekDays.map((d) => {
            const actif = selectedDay === d.ymd;
            return (
              <button
                key={d.ymd}
                type="button"
                onClick={() => {
                  setSelectedDay(d.ymd);
                  loadToday(d.ymd);
                }}
                className="shrink-0 min-w-[72px] min-h-[64px] rounded-xl px-3 py-2 text-left"
                style={{
                  background: actif ? "var(--g-primary-glow)" : "var(--g-surface)",
                  border: `1px solid ${actif ? "var(--g-primary)" : "var(--g-border)"}`,
                  boxShadow: "var(--g-shadow)",
                }}
              >
                <p className="text-xs font-semibold capitalize" style={{ color: "var(--g-text)" }}>
                  {d.label}
                </p>
                <span
                  className="inline-flex mt-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full text-white"
                  style={{ background: "var(--g-primary)" }}
                >
                  {d.count}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* FILE D'ATTENTE */}
      <section className="px-4 pt-5">
        <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--g-text)" }}>
          File d&apos;attente du jour
        </h2>

        {dayTimeline.length === 0 ? (
          <div className="text-center py-10 px-4 rounded-2xl" style={{ background: "var(--g-surface)", boxShadow: "var(--g-shadow)" }}>
            <p className="text-4xl mb-3">😊</p>
            <p className="text-sm font-semibold" style={{ color: "var(--g-text)" }}>
              Aucun créneau aujourd&apos;hui
            </p>
            <p className="text-xs mt-1" style={{ color: "var(--g-muted)" }}>
              Vérifie les horaires ou crée une réservation
            </p>
            <button
              type="button"
              onClick={() => openExpress({ date: dayDate })}
              className="mt-4 min-h-[44px] px-4 rounded-xl text-sm font-semibold"
              style={{
                color: "var(--g-primary)",
                border: "1px solid var(--g-primary)",
              }}
            >
              Nouvelle réservation
            </button>
          </div>
        ) : (
          <ul className="space-y-3">
            {dayTimeline.map((resa) => {
              const creneau = toCreneau(resa, dayDate);
              const flags = calculerFlagsMatch(creneau, resa.statut, nowMs);
              const status = resolveLiveStatus(resa, dayDate, nowMs);
              const ui = STATUS_UI[status];
              // Bouton scan card : imminent (≤30 min) ou déjà dans la fenêtre check-in
              const showScanCta =
                status === "reserve" &&
                !resa.qr_code_scanne_at &&
                ["confirme", "acceptee"].includes(resa.statut) &&
                (flags.estImminente || flags.estDansFenetre);
              const reste = Number(resa.montant_restant ?? 0);
              const avance = Number(resa.montant_avance ?? 0);

              return (
                <li
                  key={`${resa.id}-${resa.heure_debut}`}
                  className="rounded-2xl p-3.5"
                  style={{
                    background: "var(--g-surface)",
                    boxShadow: "var(--g-shadow)",
                    borderLeft: `4px solid ${ui.color}`,
                    opacity: status === "termine" ? 0.6 : 1,
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p
                        className="text-lg font-bold"
                        style={{ fontFamily: "var(--font-display)", color: "var(--g-text)" }}
                      >
                        {formatHourRange(resa.heure_debut, resa.heure_fin)}
                      </p>
                      {flags.estImminente && status === "reserve" ? (
                        <p className="text-[11px] font-semibold mt-0.5" style={{ color: "var(--g-accent)" }}>
                          Imminent — dans moins de 30 min
                        </p>
                      ) : null}
                      {status === "bloque" && resa.motif ? (
                        <p className="text-[11px] mt-0.5" style={{ color: "var(--g-muted)" }}>
                          {MOTIF_LABEL[String(resa.motif)] || resa.motif}
                        </p>
                      ) : null}
                    </div>
                    <span
                      className="text-[11px] font-semibold px-2.5 py-1 rounded-full shrink-0"
                      style={{ background: ui.bg, color: ui.color }}
                    >
                      {ui.label}
                    </span>
                  </div>

                  {(status === "reserve" || status === "en_cours") && (
                    <div className="mt-2 flex items-start gap-2">
                      <User className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: "var(--g-muted)" }} />
                      <div>
                        <p className="text-sm font-semibold" style={{ color: "var(--g-text)" }}>
                          {resa.joueur_nom || "Joueur"}
                        </p>
                        {resa.joueur_telephone && (
                          <p className="text-xs" style={{ color: "var(--g-muted)" }}>
                            {resa.joueur_telephone}
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {(status === "reserve" || status === "en_cours") && (
                    <div className="mt-2">
                      {reste > 0 ? (
                        <span
                          className="inline-flex text-[11px] font-semibold px-2.5 py-1 rounded-full"
                          style={{ background: "var(--g-en-cours-bg)", color: "var(--g-warning)" }}
                        >
                          Encaisser {reste.toLocaleString("fr-FR")} FCFA sur place
                        </span>
                      ) : avance > 0 || Number(resa.montant || resa.prix_total || 0) > 0 ? (
                        <span
                          className="inline-flex text-[11px] font-semibold px-2.5 py-1 rounded-full"
                          style={{ background: "var(--g-libre-bg)", color: "var(--g-libre)" }}
                        >
                          ✓ Totalement payé
                        </span>
                      ) : null}
                    </div>
                  )}

                  <div className="mt-3">
                    {status === "libre" && (
                      <button
                        type="button"
                        onClick={() =>
                          openExpress({
                            date: dayDate,
                            heure_debut: String(resa.heure_debut).slice(0, 5),
                            heure_fin: String(resa.heure_fin).slice(0, 5),
                          })
                        }
                        className="w-full min-h-[44px] rounded-xl text-sm font-semibold"
                        style={{
                          color: "var(--g-primary)",
                          border: "1px solid var(--g-primary)",
                        }}
                      >
                        Réserver ce créneau
                      </button>
                    )}
                    {status === "bloque" && (
                      <button
                        type="button"
                        onClick={() => void handleUnblockCreneau(resa.blocage_id)}
                        className="w-full min-h-[44px] rounded-xl text-sm font-semibold"
                        style={{
                          color: "var(--g-danger)",
                          border: "1px solid var(--g-danger)",
                        }}
                      >
                        Débloquer
                      </button>
                    )}
                    {showScanCta && (
                      <button
                        type="button"
                        onClick={() => openScanner(resa)}
                        className="w-full h-11 rounded-xl text-sm font-semibold text-white animate-pulse"
                        style={{ background: "var(--g-primary)" }}
                      >
                        📷 Valider l&apos;entrée — Scanner QR
                      </button>
                    )}
                    {status === "reserve" && !showScanCta && (
                      <button
                        type="button"
                        onClick={() => navigate(`/backoffice/gerant/reservations/${resa.id}`)}
                        className="w-full min-h-[44px] rounded-xl text-sm font-semibold"
                        style={{
                          color: "var(--g-muted)",
                          border: "1px solid var(--g-border)",
                        }}
                      >
                        Voir le détail
                      </button>
                    )}
                    {status === "en_cours" && (
                      <button
                        type="button"
                        onClick={() => navigate(`/backoffice/gerant/reservations/${resa.id}`)}
                        className="w-full min-h-[44px] rounded-xl text-sm font-semibold"
                        style={{ background: "var(--g-en-cours-bg)", color: "var(--g-en-cours)" }}
                      >
                        Match en cours — ouvrir la fiche
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <ReservationExpressModal
        open={expressOpen}
        onClose={() => setExpressOpen(false)}
        terrainId={dashboard?.terrain?.id}
        prefill={expressPrefill}
        onCreated={() => {
          loadDashboard();
          loadToday(dayDate);
        }}
      />

      <BloquerCreneauModal
        open={blockOpen}
        onClose={() => setBlockOpen(false)}
        terrainId={dashboard?.terrain?.id}
        blocages={dashboard?.blocages || []}
        onChanged={() => {
          loadDashboard();
          loadToday(dayDate);
          void loadFreeSlots(dashboard?.terrain?.id, dayDate);
        }}
      />

      <ScannerModal
        open={scannerOpen}
        onClose={() => {
          setScannerOpen(false);
          setScanTarget(null);
        }}
        expectedReservationId={scanTarget?.id ?? null}
        expectedCodeReservation={scanTarget?.code_reservation ?? null}
        onSuccess={(reservation) => {
          applyOptimisticScan(reservation);
          setScannerOpen(false);
          setScanTarget(null);
        }}
        onManualValidation={() => {
          setScannerOpen(false);
          setScanTarget(null);
          setManualOpen(true);
        }}
      />

      <ValidationManuelleModal
        open={manualOpen}
        onClose={() => setManualOpen(false)}
        reservations={todayList}
        onSuccess={(reservation) => {
          if (reservation) applyOptimisticScan(reservation);
          setManualOpen(false);
        }}
      />
    </div>
  );
};

export default ManagerDashboard;
