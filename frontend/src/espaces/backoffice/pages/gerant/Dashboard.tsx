import { Calendar, Clock, Save, Plus, Banknote, Percent, DoorOpen, CheckCircle2, ChevronRight, BadgePercent, QrCode } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useState, useEffect, useMemo } from "react";
import { gerantApi } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import BlockSlotModal from "@/espaces/backoffice/components/BlockSlotModal";
import WhatsAppGerantCard from "@/espaces/backoffice/components/WhatsAppGerantCard";
import { estDansLaFenetreCheckIn } from "@/lib/checkInFenetre";
import { localYmd } from "@/lib/localDate";

type TodayReservation = {
  id: number;
  code_reservation?: string | null;
  joueur_nom?: string | null;
  date?: string;
  heure_debut: string;
  heure_fin: string;
  statut: string;
  qr_code_scanne_at?: string | null;
  fenetre_retard?: number | null;
  dans_fenetre_checkin?: boolean;
};

const STATUS_META: Record<string, { label: string; badge: string }> = {
  confirme: {
    label: "Confirmé",
    badge: "bg-[color-mix(in_srgb,var(--color-success)_14%,white)] text-[var(--color-success)]",
  },
  match_joue: {
    label: "Match joué",
    badge: "bg-[var(--color-surface-2)] text-[var(--color-text-muted)]",
  },
  joue: {
    label: "Match joué",
    badge: "bg-[var(--color-surface-2)] text-[var(--color-text-muted)]",
  },
};

function timeToMinutes(value: string) {
  const [h, m] = String(value || "0:0").slice(0, 5).split(":").map(Number);
  return h * 60 + (m || 0);
}

function TodayListSkeleton() {
  return (
    <div className="space-y-2 animate-pulse">
      {[1, 2, 3].map((i) => (
        <div key={i} className="h-[72px] rounded-[var(--radius-md)] bg-[var(--color-surface-2)]" />
      ))}
    </div>
  );
}

const ManagerDashboard = () => {
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();
  const [dashboard, setDashboard] = useState<any>(null);
  const [todayPayload, setTodayPayload] = useState<{ date: string; reservations: TodayReservation[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingToday, setLoadingToday] = useState(true);
  const [horaires, setHoraires] = useState<any[]>([]);
  const [savingHoraires, setSavingHoraires] = useState(false);
  const [isBlockModalOpen, setIsBlockModalOpen] = useState(false);
  const [blockingSlot, setBlockingSlot] = useState(false);

  useEffect(() => {
    if (!isAuthenticated || (user?.role !== "employe" && user?.role !== "gerant" && user?.accountType !== "employe")) {
      navigate("/backoffice/login");
      return;
    }
    loadDashboard();
    loadToday();
  }, [isAuthenticated]);

  const loadDashboard = async () => {
    try {
      const data = await gerantApi.dashboard();
      setDashboard(data);
      setHoraires(data.horaires || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const loadToday = async () => {
    setLoadingToday(true);
    try {
      const data = (await gerantApi.reservationsToday()) as {
        date: string;
        reservations: TodayReservation[];
      };
      setTodayPayload(data);
    } catch (err) {
      console.error(err);
      setTodayPayload({ date: localYmd(), reservations: [] });
    } finally {
      setLoadingToday(false);
    }
  };

  const handleSaveHoraires = async () => {
    setSavingHoraires(true);
    try {
      await gerantApi.updateHoraires(horaires);
      toast.success("Horaires sauvegardés !");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSavingHoraires(false);
    }
  };

  const handleDeleteBlocage = async (id: number) => {
    try {
      await gerantApi.removeBlocage(id);
      setDashboard((prev: any) => ({
        ...prev,
        blocages: prev.blocages.filter((b: any) => b.id !== id),
      }));
      toast.success("Blocage supprimé");
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleBlockSlot = async (data: {
    date: string;
    heure_debut: string;
    heure_fin: string;
    motif: string;
  }) => {
    setBlockingSlot(true);
    try {
      const result = await gerantApi.addBlocage(data);
      setDashboard((prev: any) => ({
        ...prev,
        blocages: [...prev.blocages, result],
      }));
      toast.success("Créneau bloqué avec succès");
      setIsBlockModalOpen(false);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setBlockingSlot(false);
    }
  };

  const updateHoraire = (index: number, field: string, value: string | number) => {
    setHoraires((prev) => prev.map((h, i) => (i === index ? { ...h, [field]: value } : h)));
  };

  const todayDateLabel = useMemo(() => {
    const raw = todayPayload?.date || localYmd();
    return new Date(`${raw}T00:00:00`).toLocaleDateString("fr-FR", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }, [todayPayload?.date]);

  const nextUpcomingId = useMemo(() => {
    const list = todayPayload?.reservations || [];
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const upcoming = list.find((r) => {
      const played = ["match_joue", "joue"].includes(r.statut) || Boolean(r.qr_code_scanne_at);
      return !played && timeToMinutes(r.heure_debut) >= nowMin;
    });
    return upcoming?.id ?? null;
  }, [todayPayload?.reservations]);

  const aValiderMaintenant = useMemo(() => {
    const date = todayPayload?.date || localYmd();
    return (todayPayload?.reservations || []).filter((r) => {
      if (r.statut !== "confirme" || r.qr_code_scanne_at) return false;
      // Toujours recalculer côté client
      return estDansLaFenetreCheckIn({
        date: r.date || date,
        heure_debut: r.heure_debut,
        heure_fin: r.heure_fin,
        fenetre_retard: r.fenetre_retard,
      });
    });
  }, [todayPayload?.date, todayPayload?.reservations]);

  const stats = useMemo(() => {
    const todayRes = todayPayload?.reservations || [];
    const activeToday = todayRes.filter((r) =>
      ["confirme", "match_joue", "joue"].includes(r.statut)
    );
    const all = dashboard?.reservations || [];
    const todayStr = todayPayload?.date || localYmd();
    const fallbackToday = all.filter((r: any) => r.date === todayStr);
    const source = todayRes.length > 0 ? todayRes : fallbackToday;
    const revenusJour = source.reduce(
      (sum: number, r: any) => sum + Number(r.montant_total || r.montant || r.prix_total || 0),
      0
    );
    const jours = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
    const todayHoraire = (horaires || []).find((h: any) => h.jour === jours[new Date().getDay()]);
    let slotsToday = 0;
    if (todayHoraire?.est_ouvert && todayHoraire.heure_debut && todayHoraire.heure_fin) {
      const start = parseInt(String(todayHoraire.heure_debut).split(":")[0], 10);
      const endRaw = parseInt(String(todayHoraire.heure_fin).split(":")[0], 10);
      const end = endRaw === 0 ? 24 : endRaw;
      slotsToday = Math.max(0, end - start);
    }
    const reservedSlots = activeToday.length;
    const libres = Math.max(0, slotsToday - reservedSlots);
    const occupation =
      slotsToday > 0 ? Math.min(100, Math.round((reservedSlots / slotsToday) * 100)) : 0;

    return {
      resaJour: todayRes.length || source.length,
      revenusJour,
      libres,
      occupation,
    };
  }, [dashboard, horaires, todayPayload]);

  if (loading) {
    return (
      <div className="space-y-6 max-w-5xl mx-auto animate-pulse">
        <div className="h-8 w-48 rounded bg-[var(--color-surface-2)]" />
        <div className="grid grid-cols-2 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 rounded-[var(--radius-md)] bg-[var(--color-surface-2)]" />
          ))}
        </div>
        <TodayListSkeleton />
      </div>
    );
  }

  const jourLabels: Record<string, string> = {
    lundi: "Lundi",
    mardi: "Mardi",
    mercredi: "Mercredi",
    jeudi: "Jeudi",
    vendredi: "Vendredi",
    samedi: "Samedi",
    dimanche: "Dimanche",
  };

  const blockedSlots = dashboard?.blocages || [];
  const todayList = todayPayload?.reservations || [];
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();

  const statCards = [
    {
      label: "Réservations du jour",
      value: String(stats.resaJour),
      icon: Calendar,
      tint: "bg-[color-mix(in_srgb,var(--color-primary)_12%,white)] text-[var(--color-primary)]",
    },
    {
      label: "Revenus du jour",
      value: `${stats.revenusJour.toLocaleString()}`,
      suffix: "CFA",
      icon: Banknote,
      tint: "bg-[color-mix(in_srgb,var(--color-accent)_18%,white)] text-[var(--color-accent)]",
    },
    {
      label: "Créneaux libres",
      value: String(stats.libres),
      icon: DoorOpen,
      tint: "bg-[color-mix(in_srgb,var(--color-info)_12%,white)] text-[var(--color-info)]",
    },
    {
      label: "Taux d'occupation",
      value: `${stats.occupation}`,
      suffix: "%",
      icon: Percent,
      tint: "bg-[color-mix(in_srgb,var(--color-warning)_14%,white)] text-[var(--color-warning)]",
    },
  ];

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <h1
          className="text-xl font-semibold text-[var(--color-text-primary)]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Dashboard
        </h1>
        <p className="text-sm text-[var(--color-text-secondary)] mt-1">
          {dashboard?.monthReservations || 0} réservations au total ·{" "}
          {dashboard?.pendingCount || 0} en attente de paiement
        </p>
      </div>

      <WhatsAppGerantCard />

      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        {statCards.map((card) => (
          <div
            key={card.label}
            className="bg-white rounded-[var(--radius-md)] border border-[var(--color-border)] p-4 shadow-sm"
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs text-[var(--color-text-secondary)] leading-snug">{card.label}</p>
              <span className={`inline-flex items-center justify-center w-9 h-9 rounded-full ${card.tint}`}>
                <card.icon className="w-4 h-4" />
              </span>
            </div>
            <p
              className="mt-3 text-[28px] leading-none font-semibold text-[var(--color-text-primary)]"
              style={{ fontFamily: "var(--font-display)" }}
            >
              {card.value}
              {card.suffix && (
                <span className="text-sm font-medium text-[var(--color-text-muted)] ml-1">
                  {card.suffix}
                </span>
              )}
            </p>
          </div>
        ))}
      </div>

      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="section-title">Réservations du jour</h2>
            <p className="text-sm text-[var(--color-text-secondary)] capitalize mt-0.5">{todayDateLabel}</p>
          </div>
          <button
            type="button"
            onClick={() => navigate("/backoffice/gerant/flux")}
            className="shrink-0 h-9 px-3 rounded-[var(--radius-sm)] bg-[var(--color-primary)] text-white text-sm font-medium"
          >
            Flux du jour
          </button>
        </div>

        {aValiderMaintenant.length > 0 && (
          <div className="mb-4 rounded-[var(--radius-md)] border border-[var(--color-primary)] bg-[color-mix(in_srgb,var(--color-primary)_8%,white)] p-3 space-y-2">
            <div className="flex items-center gap-2">
              <QrCode className="w-4 h-4 text-[var(--color-primary)]" />
              <h3 className="text-sm font-semibold text-[var(--color-primary)]">
                Matchs à valider maintenant
              </h3>
            </div>
            <ul className="flex flex-col gap-2">
              {aValiderMaintenant.map((resa) => (
                <li key={`imminent-${resa.id}`}>
                  <button
                    type="button"
                    onClick={() => navigate(`/backoffice/gerant/reservations/${resa.id}`)}
                    className="w-full text-left bg-white rounded-[var(--radius-md)] border border-[var(--color-primary)] p-3 flex items-center gap-3"
                  >
                    <div className="min-w-[4.5rem] shrink-0">
                      <p className="text-sm font-semibold" style={{ fontFamily: "var(--font-display)" }}>
                        {String(resa.heure_debut).slice(0, 5)}
                      </p>
                      <p className="text-xs text-[var(--color-text-muted)]">
                        – {String(resa.heure_fin).slice(0, 5)}
                      </p>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{resa.joueur_nom || "Joueur"}</p>
                      <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                        {resa.code_reservation || `Résa #${resa.id}`} · Scanner prêt
                      </p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-[var(--color-primary)] shrink-0" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {loadingToday ? (
          <TodayListSkeleton />
        ) : todayList.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)] text-center py-8 bg-white rounded-[var(--radius-md)] border border-[var(--color-border)]">
            Aucune réservation aujourd&apos;hui
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {todayList.map((resa) => {
              const start = timeToMinutes(resa.heure_debut);
              const end = timeToMinutes(resa.heure_fin);
              const inProgress = nowMin >= start && nowMin < end;
              const played = ["match_joue", "joue"].includes(resa.statut) || Boolean(resa.qr_code_scanne_at);
              const isNext = resa.id === nextUpcomingId && !inProgress;
              const meta = STATUS_META[resa.statut] || {
                label: resa.statut,
                badge: "bg-[var(--color-surface-2)] text-[var(--color-text-muted)]",
              };

              return (
                <li key={resa.id}>
                  <button
                    type="button"
                    onClick={() => navigate(`/backoffice/gerant/reservations/${resa.id}`)}
                    className={`w-full text-left bg-white rounded-[var(--radius-md)] border p-3 flex items-center gap-3 transition-colors ${
                      inProgress
                        ? "border-[var(--color-primary)] border-l-4 shadow-sm"
                        : played
                          ? "border-[var(--color-border)] opacity-70"
                          : "border-[var(--color-border)] hover:border-[var(--color-primary)]"
                    }`}
                  >
                    <div className="min-w-[4.5rem] shrink-0">
                      <p className="text-sm font-semibold" style={{ fontFamily: "var(--font-display)" }}>
                        {String(resa.heure_debut).slice(0, 5)}
                      </p>
                      <p className="text-xs text-[var(--color-text-muted)]">
                        – {String(resa.heure_fin).slice(0, 5)}
                      </p>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium text-sm truncate">{resa.joueur_nom || "Joueur"}</p>
                        {isNext && (
                          <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-[color-mix(in_srgb,var(--color-accent)_22%,white)] text-[var(--color-primary-dark)]">
                            Suivant
                          </span>
                        )}
                        {played && <CheckCircle2 className="w-4 h-4 text-[var(--color-success)] shrink-0" />}
                      </div>
                      <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                        {resa.code_reservation || `Résa #${resa.id}`}
                      </p>
                    </div>
                    <span className={`shrink-0 text-[11px] font-semibold px-2.5 py-1 rounded-full ${meta.badge}`}>
                      {meta.label}
                    </span>
                    <ChevronRight className="w-4 h-4 text-[var(--color-text-muted)] shrink-0" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="flex flex-col sm:flex-row gap-3">
        <button
          type="button"
          onClick={() => navigate("/backoffice/gerant/creneaux")}
          className="flex-1 min-h-[48px] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-white text-sm font-medium inline-flex items-center justify-center gap-2"
        >
          <Calendar className="w-4 h-4 text-[var(--color-primary)]" />
          Voir les créneaux
        </button>
        <button
          type="button"
          onClick={() => navigate("/backoffice/gerant/tarifs")}
          className="flex-1 min-h-[48px] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-white text-sm font-medium inline-flex items-center justify-center gap-2"
        >
          <BadgePercent className="w-4 h-4 text-[var(--color-primary)]" />
          Tarifs dynamiques
        </button>
        <button
          type="button"
          onClick={() => navigate("/backoffice/gerant/reservations")}
          className="flex-1 min-h-[48px] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-white text-sm font-medium inline-flex items-center justify-center gap-2"
        >
          <Clock className="w-4 h-4 text-[var(--color-primary)]" />
          Gérer les réservations
        </button>
      </div>

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="section-title">Créneaux bloqués</h2>
          <button
            type="button"
            onClick={() => setIsBlockModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 min-h-[40px] rounded-[var(--radius-sm)] border border-[var(--color-border)] text-xs font-medium"
          >
            <Plus className="w-3.5 h-3.5" /> Bloquer
          </button>
        </div>
        <div className="flex flex-col gap-2">
          {blockedSlots.map((slot: any) => (
            <div
              key={slot.id}
              className="bg-white rounded-[var(--radius-md)] border border-[var(--color-border)] border-l-4 border-l-[var(--color-danger)] p-3 flex items-center gap-3"
            >
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm" style={{ fontFamily: "var(--font-display)" }}>
                  {slot.date}
                </p>
                <p className="text-xs text-[var(--color-text-muted)]">
                  {slot.heure_debut} – {slot.heure_fin} · {slot.motif}
                </p>
              </div>
              <button
                type="button"
                className="text-xs font-medium text-[var(--color-danger)] min-h-[40px] px-2"
                onClick={() => handleDeleteBlocage(slot.id)}
              >
                Supprimer
              </button>
            </div>
          ))}
          {blockedSlots.length === 0 && (
            <p className="text-sm text-[var(--color-text-muted)] text-center py-4">
              Aucun créneau bloqué
            </p>
          )}
        </div>
      </section>

      <section>
        <h2 className="section-title mb-3">Horaires d&apos;ouverture</h2>
        <p className="text-xs text-[var(--color-text-muted)] mb-3">
          Début / fin libres (ex. 06:00 → 00:00). Fin à <strong>00:00</strong> = jusqu&apos;à
          minuit, avec le créneau « Jeudi minuit » = vendredi 00:00 stocké en calendrier.
        </p>
        <div className="bg-white rounded-[var(--radius-md)] border border-[var(--color-border)] p-4">
          {horaires.map((h, index) => (
            <div
              key={h.jour}
              className="flex flex-wrap items-center justify-between py-2.5 border-b border-[var(--color-border)] last:border-0 gap-2"
            >
              <div className="flex items-center gap-2 w-28 shrink-0">
                <input
                  type="checkbox"
                  checked={Boolean(h.est_ouvert)}
                  onChange={(e) => updateHoraire(index, "est_ouvert", e.target.checked ? 1 : 0)}
                  className="rounded border-[var(--color-border)]"
                  aria-label={`Ouvert ${h.jour}`}
                />
                <span className="text-sm font-medium">{jourLabels[h.jour] || h.jour}</span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="time"
                  value={h.heure_debut}
                  disabled={!h.est_ouvert}
                  onChange={(e) => updateHoraire(index, "heure_debut", e.target.value)}
                  className="bg-[var(--color-surface-2)] rounded-lg px-2 py-2 text-sm w-[6.5rem] disabled:opacity-40"
                />
                <span className="text-[var(--color-text-muted)] text-xs">→</span>
                <input
                  type="time"
                  value={h.heure_fin}
                  disabled={!h.est_ouvert}
                  onChange={(e) => updateHoraire(index, "heure_fin", e.target.value)}
                  className="bg-[var(--color-surface-2)] rounded-lg px-2 py-2 text-sm w-[6.5rem] disabled:opacity-40"
                />
              </div>
            </div>
          ))}
          <button
            type="button"
            className="w-full mt-4 min-h-[52px] rounded-[var(--radius-md)] bg-[var(--color-primary)] text-white text-sm font-medium inline-flex items-center justify-center gap-2 disabled:bg-[var(--color-text-muted)]"
            onClick={handleSaveHoraires}
            disabled={savingHoraires}
          >
            <Save className="w-4 h-4" />
            {savingHoraires ? "Sauvegarde..." : "Enregistrer les horaires"}
          </button>
        </div>
      </section>

      <BlockSlotModal
        isOpen={isBlockModalOpen}
        onClose={() => setIsBlockModalOpen(false)}
        onSubmit={handleBlockSlot}
        isLoading={blockingSlot}
      />
    </div>
  );
};

export default ManagerDashboard;
