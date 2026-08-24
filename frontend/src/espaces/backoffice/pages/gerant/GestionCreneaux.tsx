import { useState, useEffect } from "react";
import { ChevronLeft, ChevronRight, User, XCircle, Phone, Calendar } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { gerantApi, reservationsApi } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { hoursRangeFromHoraires, labelHeureSenegal, formatHour } from "@/lib/scheduleSn";
import { localYmd } from "@/lib/localDate";
import EnAttentePaiementActions from "@/espaces/backoffice/components/EnAttentePaiementActions";

const statusConfig: Record<string, { label: string; className: string }> = {
  en_attente: {
    label: "En attente de paiement",
    className: "bg-[var(--g-en-attente-bg)] text-[var(--g-en-attente)]",
  },
  confirme: {
    label: "Réservé ✓",
    className: "bg-[color-mix(in_srgb,var(--color-success)_14%,white)] text-[var(--color-success)]",
  },
  joue: {
    label: "Terminé ✓",
    className: "bg-[var(--color-primary)] text-white",
  },
  match_joue: {
    label: "Terminé ✓",
    className: "bg-[var(--color-primary)] text-white",
  },
  acceptee: {
    label: "Réservé ✓",
    className: "bg-[color-mix(in_srgb,var(--color-success)_14%,white)] text-[var(--color-success)]",
  },
  refusee: {
    label: "Refusée",
    className: "bg-[color-mix(in_srgb,var(--color-danger)_12%,white)] text-[var(--color-danger)]",
  },
  annulee: {
    label: "Annulée",
    className: "bg-[var(--color-surface-2)] text-[var(--color-text-muted)]",
  },
};

const ManagerCalendar = () => {
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();
  const [loading, setLoading] = useState(true);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [reservations, setReservations] = useState<any[]>([]);
  const [blocages, setBlocages] = useState<any[]>([]);
  const [horaires, setHoraires] = useState<any[]>([]);
  const [features, setFeatures] = useState<Record<string, boolean> | null>(null);
  const [selectedReservation, setSelectedReservation] = useState<any>(null);
  const [selectedBlocage, setSelectedBlocage] = useState<any>(null);
  const [processing, setProcessing] = useState(false);
  const [selectedDayIdx, setSelectedDayIdx] = useState(0);

  useEffect(() => {
    if (
      !isAuthenticated ||
      (user?.role !== "employe" && user?.role !== "gerant" && user?.accountType !== "employe")
    ) {
      navigate("/backoffice/login");
      return;
    }
    loadData();
  }, [isAuthenticated, currentDate]);

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await gerantApi.dashboard();
      setReservations(data.reservations || []);
      setBlocages(data.blocages || []);
      setHoraires(data.horaires || []);
      setFeatures(
        data?.features && typeof data.features === "object" ? (data.features as Record<string, boolean>) : {},
      );
    } catch (err: any) {
      toast.error(err.message || "Erreur lors du chargement");
    } finally {
      setLoading(false);
    }
  };

  const getStartOfWeek = (date: Date) => {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    return new Date(d.setDate(diff));
  };

  const startOfWeek = getStartOfWeek(currentDate);
  const weekDays: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(startOfWeek);
    d.setDate(d.getDate() + i);
    weekDays.push(d);
  }

  const timeSlots = (() => {
    const slots = hoursRangeFromHoraires(horaires, { min: 6, max: 24 });
    if (slots.length) return slots;
    return Array.from({ length: 18 }, (_, i) => formatHour(i + 6));
  })();

  const formatDate = (date: Date) => localYmd(date);

  const formatDay = (date: Date) => {
    const days = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];
    return { weekday: days[date.getDay()], day: date.getDate() };
  };

  const isToday = (date: Date) => {
    const today = new Date();
    return (
      date.getDate() === today.getDate() &&
      date.getMonth() === today.getMonth() &&
      date.getFullYear() === today.getFullYear()
    );
  };

  const getSlotStatus = (date: Date, time: string) => {
    const dateStr = formatDate(date);
    const blocage = blocages.find(
      (b) => b.date === dateStr && time >= b.heure_debut && time < b.heure_fin
    );
    if (blocage) return { status: "blocked" as const, data: blocage };

    const reservation = reservations.find(
      (r) =>
        r.date === dateStr &&
        time >= r.heure_debut &&
        time < r.heure_fin &&
        ["confirme", "acceptee", "joue", "match_joue"].includes(r.statut)
    );
    if (reservation) return { status: "reserved" as const, data: reservation };

    return { status: "free" as const, data: null };
  };

  const handlePrevWeek = () => {
    const newDate = new Date(currentDate);
    newDate.setDate(newDate.getDate() - 7);
    setCurrentDate(newDate);
  };

  const handleNextWeek = () => {
    const newDate = new Date(currentDate);
    newDate.setDate(newDate.getDate() + 7);
    setCurrentDate(newDate);
  };

  const handleToday = () => {
    setCurrentDate(new Date());
    const today = new Date();
    const start = getStartOfWeek(today);
    const idx = Math.floor((today.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    setSelectedDayIdx(Math.min(6, Math.max(0, idx)));
  };

  const handleTraiterReservation = async (id: number, action: "acceptee" | "refusee") => {
    setProcessing(true);
    try {
      await reservationsApi.traiter(id, action);
      setReservations((prev) => prev.map((r) => (r.id === id ? { ...r, statut: action } : r)));
      setSelectedReservation(null);
      toast.success(`Réservation ${action === "acceptee" ? "acceptée" : "refusée"}`);
    } catch (err: any) {
      toast.error(err.message || "Erreur lors du traitement");
    } finally {
      setProcessing(false);
    }
  };

  const handleOpenFiche = (id: number) => {
    setSelectedReservation(null);
    navigate(`/backoffice/gerant/reservations/${id}`);
  };

  const getBlocageLabel = (motif: string) => {
    const labels: Record<string, string> = {
      entretien: "Entretien",
      maintenance: "Maintenance",
      evenement_prive: "Événement privé",
      meteo: "Météo",
    };
    return labels[motif] || "Bloqué";
  };

  const activeDay = weekDays[selectedDayIdx] || weekDays[0];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-pulse text-[var(--color-text-secondary)] text-sm">Chargement...</div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1
            className="text-xl font-semibold text-[var(--color-text-primary)]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Heures de match
          </h1>
          <p className="text-sm text-[var(--color-text-secondary)] mt-1">
            Semaine du {startOfWeek.getDate()} au {weekDays[6].getDate()}{" "}
            {startOfWeek.toLocaleDateString("fr-FR", { month: "long" })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handlePrevWeek}
            className="w-10 h-10 rounded-full border border-[var(--color-border)] bg-white flex items-center justify-center"
            aria-label="Semaine précédente"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={handleToday}
            className="min-h-[40px] px-3 rounded-full border border-[var(--color-border)] bg-white text-xs font-medium"
          >
            Aujourd&apos;hui
          </button>
          <button
            type="button"
            onClick={handleNextWeek}
            className="w-10 h-10 rounded-full border border-[var(--color-border)] bg-white flex items-center justify-center"
            aria-label="Semaine suivante"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Semaine scrollable */}
      <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
        {weekDays.map((day, idx) => {
          const meta = formatDay(day);
          const selected = selectedDayIdx === idx;
          return (
            <button
              key={idx}
              type="button"
              onClick={() => setSelectedDayIdx(idx)}
              className={`flex flex-col items-center min-w-[3.5rem] min-h-[72px] py-2 px-3 rounded-[var(--radius-md)] flex-shrink-0 transition-colors ${
                selected
                  ? "bg-[var(--color-primary)] text-white"
                  : isToday(day)
                    ? "bg-[color-mix(in_srgb,var(--color-primary)_10%,white)] text-[var(--color-primary)] border border-[var(--color-primary)]"
                    : "bg-white border border-[var(--color-border)] text-[var(--color-text-secondary)]"
              }`}
            >
              <span className="text-[10px] opacity-80">{meta.weekday}</span>
              <span
                className="text-lg font-semibold mt-0.5"
                style={{ fontFamily: "var(--font-display)" }}
              >
                {meta.day}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-[var(--color-text-secondary)]">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-[color-mix(in_srgb,var(--color-success)_40%,white)]" />{" "}
          Libre
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-[var(--color-warning)]" /> Réservé
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-[var(--color-danger)]" /> Bloqué
        </span>
        <span className="text-[var(--color-text-muted)]">
          00:00 = minuit de la veille (ex. Ven 00h → Jeudi minuit)
        </span>
      </div>

      {/* Liste du jour */}
      <div className="flex flex-col gap-2">
        {timeSlots.map((time) => {
          const { status, data } = getSlotStatus(activeDay, time);
          return (
            <div
              key={time}
              className={`bg-white rounded-[var(--radius-md)] border border-[var(--color-border)] p-3 flex items-center gap-3 ${
                status === "free"
                  ? "border-l-4 border-l-[var(--color-success)]"
                  : status === "reserved"
                    ? "border-l-4 border-l-[var(--color-warning)]"
                    : "border-l-4 border-l-[var(--color-danger)]"
              }`}
            >
              <p
                className="text-sm sm:text-xl font-semibold w-[4.5rem] sm:w-20 shrink-0 text-[var(--color-text-primary)] leading-tight"
                style={{ fontFamily: "var(--font-display)" }}
              >
                {labelHeureSenegal(formatDate(activeDay), time)}
              </p>
              <div className="flex-1 min-w-0">
                {status === "free" && (
                  <span className="inline-flex text-[11px] font-medium px-2.5 py-1 rounded-full bg-[color-mix(in_srgb,var(--color-success)_12%,white)] text-[var(--color-success)]">
                    Libre
                  </span>
                )}
                {status === "reserved" && (
                  <div>
                    <span className="inline-flex text-[11px] font-medium px-2.5 py-1 rounded-full bg-[color-mix(in_srgb,var(--color-warning)_16%,white)] text-[var(--color-warning)]">
                      Réservé
                    </span>
                    <p className="text-sm font-medium mt-1 truncate">{data?.joueur_nom}</p>
                  </div>
                )}
                {status === "blocked" && (
                  <span className="inline-flex text-[11px] font-medium px-2.5 py-1 rounded-full bg-[color-mix(in_srgb,var(--color-danger)_12%,white)] text-[var(--color-danger)]">
                    {getBlocageLabel(data?.motif)}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  if (status === "reserved") setSelectedReservation(data);
                  else if (status === "blocked") setSelectedBlocage(data);
                }}
                className="min-h-[40px] px-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] text-xs font-medium text-[var(--color-text-secondary)] disabled:opacity-40"
                disabled={status === "free"}
              >
                Modifier
              </button>
            </div>
          );
        })}
      </div>

      <Dialog open={!!selectedReservation} onOpenChange={() => setSelectedReservation(null)}>
        <DialogContent className="max-w-md mx-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Calendar className="w-5 h-5" />
              Détails de la réservation
            </DialogTitle>
            <DialogDescription>Informations sur ce créneau</DialogDescription>
          </DialogHeader>
          {selectedReservation && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-[color-mix(in_srgb,var(--color-primary)_12%,white)] flex items-center justify-center">
                  <User className="w-5 h-5 text-[var(--color-primary)]" />
                </div>
                <div>
                  <p className="font-semibold">{selectedReservation.joueur_nom}</p>
                  {selectedReservation.joueur_telephone && (
                    <p className="text-xs text-[var(--color-text-muted)] flex items-center gap-1">
                      <Phone className="w-3 h-3" /> {selectedReservation.joueur_telephone}
                    </p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 p-3 bg-[var(--color-surface-2)] rounded-[var(--radius-md)]">
                <div>
                  <p className="text-[10px] text-[var(--color-text-muted)]">Date</p>
                  <p className="text-sm font-medium">{selectedReservation.date}</p>
                </div>
                <div>
                  <p className="text-[10px] text-[var(--color-text-muted)]">Horaire</p>
                  <p className="text-sm font-medium">
                    {selectedReservation.heure_debut} – {selectedReservation.heure_fin}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-[var(--color-text-muted)]">Montant</p>
                  <p className="text-sm font-medium text-[var(--color-primary)]">
                    {(selectedReservation.prix_total || selectedReservation.montant || 0).toLocaleString()}{" "}
                    CFA
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-[var(--color-text-muted)]">Statut</p>
                  <span
                    className={`inline-flex text-[10px] font-medium px-2 py-0.5 rounded-full mt-0.5 ${
                      statusConfig[selectedReservation.statut]?.className || ""
                    }`}
                  >
                    {statusConfig[selectedReservation.statut]?.label || selectedReservation.statut}
                  </span>
                </div>
              </div>

              {selectedReservation.statut === "en_attente" && (
                <div className="space-y-3 pt-2">
                  <EnAttentePaiementActions
                    reservationId={selectedReservation.id}
                    montantAvance={selectedReservation.montant_avance}
                    features={features}
                    variant="compact"
                    onDone={() => {
                      setSelectedReservation(null);
                      void loadData();
                    }}
                  />
                  <button
                    type="button"
                    className="w-full min-h-[44px] rounded-[var(--radius-md)] bg-[var(--color-primary)] text-white text-sm font-medium"
                    onClick={() => handleOpenFiche(selectedReservation.id)}
                  >
                    Ouvrir la fiche complète
                  </button>
                </div>
              )}
              {selectedReservation.statut === "confirme" && (
                <DialogFooter>
                  <button
                    type="button"
                    className="w-full min-h-[52px] rounded-[var(--radius-md)] bg-[var(--color-primary)] text-white text-sm font-medium"
                    onClick={() => handleOpenFiche(selectedReservation.id)}
                  >
                    Ouvrir la fiche et scanner le QR
                  </button>
                </DialogFooter>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!selectedBlocage} onOpenChange={() => setSelectedBlocage(null)}>
        <DialogContent className="max-w-md mx-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <XCircle className="w-5 h-5 text-[var(--color-danger)]" />
              Créneau bloqué
            </DialogTitle>
            <DialogDescription>Ce créneau n&apos;est pas disponible</DialogDescription>
          </DialogHeader>
          {selectedBlocage && (
            <div className="grid grid-cols-2 gap-3 p-3 bg-[var(--color-surface-2)] rounded-[var(--radius-md)]">
              <div>
                <p className="text-[10px] text-[var(--color-text-muted)]">Date</p>
                <p className="text-sm font-medium">{selectedBlocage.date}</p>
              </div>
              <div>
                <p className="text-[10px] text-[var(--color-text-muted)]">Horaire</p>
                <p className="text-sm font-medium">
                  {selectedBlocage.heure_debut} – {selectedBlocage.heure_fin}
                </p>
              </div>
              <div className="col-span-2">
                <p className="text-[10px] text-[var(--color-text-muted)]">Motif</p>
                <p className="text-sm font-medium">{getBlocageLabel(selectedBlocage.motif)}</p>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ManagerCalendar;
