import { Calendar, Clock, Save, Plus, Banknote, Percent, DoorOpen } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useState, useEffect, useMemo } from "react";
import { gerantApi } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import BlockSlotModal from "@/espaces/backoffice/components/BlockSlotModal";

const ManagerDashboard = () => {
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();
  const [dashboard, setDashboard] = useState<any>(null);
  const [loading, setLoading] = useState(true);
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

  const updateHoraire = (index: number, field: string, value: string) => {
    setHoraires((prev) => prev.map((h, i) => (i === index ? { ...h, [field]: value } : h)));
  };

  const stats = useMemo(() => {
    const todayStr = new Date().toISOString().split("T")[0];
    const all = dashboard?.reservations || [];
    const todayRes = all.filter((r: any) => r.date === todayStr);
    const activeToday = todayRes.filter((r: any) =>
      ["en_attente", "confirme", "acceptee", "joue"].includes(r.statut)
    );
    const revenusJour = activeToday.reduce(
      (sum: number, r: any) => sum + Number(r.montant || r.prix_total || 0),
      0
    );
    const openHours = (horaires || []).reduce((sum: number, h: any) => {
      if (!h.heure_debut || !h.heure_fin) return sum;
      const start = parseInt(String(h.heure_debut).split(":")[0], 10);
      const end = parseInt(String(h.heure_fin).split(":")[0], 10);
      return sum + Math.max(0, end - start);
    }, 0);
    const slotsPerDay = openHours > 0 ? Math.round(openHours / 7) : 14;
    const reservedSlots = activeToday.length;
    const libres = Math.max(0, slotsPerDay - reservedSlots);
    const occupation =
      slotsPerDay > 0 ? Math.min(100, Math.round((reservedSlots / slotsPerDay) * 100)) : 0;

    return {
      resaJour: todayRes.length,
      revenusJour,
      libres,
      occupation,
    };
  }, [dashboard, horaires]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-pulse text-[var(--color-text-secondary)] text-sm">Chargement...</div>
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
          {dashboard?.pendingCount || 0} en attente
        </p>
      </div>

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
        <div className="bg-white rounded-[var(--radius-md)] border border-[var(--color-border)] p-4">
          {horaires.map((h, index) => (
            <div
              key={h.jour}
              className="flex items-center justify-between py-2.5 border-b border-[var(--color-border)] last:border-0 gap-2"
            >
              <span className="text-sm font-medium w-24 shrink-0">
                {jourLabels[h.jour] || h.jour}
              </span>
              <div className="flex items-center gap-2">
                <input
                  type="time"
                  value={h.heure_debut}
                  onChange={(e) => updateHoraire(index, "heure_debut", e.target.value)}
                  className="bg-[var(--color-surface-2)] rounded-lg px-2 py-2 text-sm w-[6.5rem]"
                />
                <span className="text-[var(--color-text-muted)] text-xs">→</span>
                <input
                  type="time"
                  value={h.heure_fin}
                  onChange={(e) => updateHoraire(index, "heure_fin", e.target.value)}
                  className="bg-[var(--color-surface-2)] rounded-lg px-2 py-2 text-sm w-[6.5rem]"
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
