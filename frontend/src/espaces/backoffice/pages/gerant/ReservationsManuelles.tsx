import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { gerantApi, reservationsApi } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

const statusMeta: Record<string, { label: string; border: string; badge: string }> = {
  en_attente: {
    label: "En attente",
    border: "border-l-[var(--color-warning)]",
    badge: "bg-[color-mix(in_srgb,var(--color-warning)_16%,white)] text-[var(--color-warning)]",
  },
  confirme: {
    label: "Confirmée",
    border: "border-l-[var(--color-success)]",
    badge: "bg-[color-mix(in_srgb,var(--color-success)_14%,white)] text-[var(--color-success)]",
  },
  acceptee: {
    label: "Acceptée",
    border: "border-l-[var(--color-success)]",
    badge: "bg-[color-mix(in_srgb,var(--color-success)_14%,white)] text-[var(--color-success)]",
  },
  joue: {
    label: "Jouée",
    border: "border-l-[var(--color-primary)]",
    badge: "bg-[var(--color-primary)] text-white",
  },
  refusee: {
    label: "Refusée",
    border: "border-l-[var(--color-danger)]",
    badge: "bg-[color-mix(in_srgb,var(--color-danger)_12%,white)] text-[var(--color-danger)]",
  },
  annulee: {
    label: "Annulée",
    border: "border-l-[var(--color-text-muted)]",
    badge: "bg-[var(--color-surface-2)] text-[var(--color-text-muted)]",
  },
  annule: {
    label: "Annulée",
    border: "border-l-[var(--color-text-muted)]",
    badge: "bg-[var(--color-surface-2)] text-[var(--color-text-muted)]",
  },
};

export default function ReservationsManuelles() {
  const { user, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [dashboard, setDashboard] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [manualLoading, setManualLoading] = useState(false);
  const [dateFilter, setDateFilter] = useState<"today" | "week" | "all">("today");
  const [manual, setManual] = useState({
    joueur_nom: "",
    joueur_telephone: "",
    date: "",
    heure_debut: "",
    heure_fin: "",
    format_terrain: "entier" as "moitie" | "entier",
  });

  useEffect(() => {
    if (
      !isAuthenticated ||
      (user?.role !== "employe" && user?.role !== "gerant" && user?.accountType !== "employe")
    ) {
      navigate("/backoffice/login");
      return;
    }
    load();
  }, [isAuthenticated]);

  const load = async () => {
    try {
      const data = await gerantApi.dashboard();
      setDashboard(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const filterReservations = (reservations: any[]) => {
    if (dateFilter === "all") return reservations;
    const today = new Date();
    const todayStr = today.toISOString().split("T")[0];
    if (dateFilter === "today") {
      return reservations.filter((r: any) => r.date === todayStr);
    }
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - today.getDay() + 1);
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    return reservations.filter((r: any) => {
      const rDate = new Date(r.date);
      return rDate >= startOfWeek && rDate <= endOfWeek;
    });
  };

  const handleMatchJoue = async (id: number) => {
    if (!window.confirm("Confirmer que le match est joué et que le solde a été encaissé en espèces ?"))
      return;
    try {
      await reservationsApi.marquerJoue(id, "especes");
      toast.success("Match joué : solde encaissé et revenu comptabilisé");
      await load();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!dashboard?.terrain?.id) return;
    setManualLoading(true);
    try {
      await reservationsApi.createGerant({ ...manual, terrain_id: dashboard.terrain.id });
      toast.success("Lien de paiement envoyé au joueur par SMS");
      setManual({
        joueur_nom: "",
        joueur_telephone: "",
        date: "",
        heure_debut: "",
        heure_fin: "",
        format_terrain: "entier",
      });
      await load();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setManualLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="text-[var(--color-text-secondary)] animate-pulse text-sm py-10 text-center">
        Chargement...
      </div>
    );
  }

  const allReservations = dashboard?.reservations || [];
  const filtered = filterReservations(allReservations);

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      <div>
        <h1
          className="text-xl font-semibold text-[var(--color-text-primary)]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Réservations
        </h1>
        <p className="text-sm text-[var(--color-text-secondary)] mt-1">
          Terrain : {dashboard?.terrain?.nom || "—"}
        </p>
      </div>

      <div className="flex gap-2 overflow-x-auto scrollbar-hide">
        {(
          [
            { id: "today" as const, label: "Aujourd'hui" },
            { id: "week" as const, label: "Cette semaine" },
            { id: "all" as const, label: "Tout" },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setDateFilter(t.id)}
            className={`px-4 min-h-[40px] rounded-full text-sm font-medium flex-shrink-0 ${
              dateFilter === t.id
                ? "bg-[var(--color-primary)] text-white"
                : "bg-white border border-[var(--color-border)] text-[var(--color-text-secondary)]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Mobile cards */}
      <div className="flex flex-col gap-3 md:hidden">
        {filtered.map((r: any) => {
          const meta = statusMeta[r.statut] || statusMeta.en_attente;
          return (
            <article
              key={r.id}
              className={`bg-white rounded-[var(--radius-md)] border border-[var(--color-border)] border-l-4 ${meta.border} p-4 shadow-sm`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p
                    className="font-semibold text-sm truncate"
                    style={{ fontFamily: "var(--font-display)" }}
                  >
                    {r.joueur_nom}
                  </p>
                  <p className="text-xs text-[var(--color-text-muted)] mt-1 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {r.date} · {r.heure_debut}–{r.heure_fin}
                  </p>
                </div>
                <span className={`text-[10px] font-medium px-2.5 py-1 rounded-full ${meta.badge}`}>
                  {meta.label}
                </span>
              </div>
              <p className="text-xs text-[var(--color-text-secondary)] mt-2">
                {(r.montant || 0).toLocaleString()} CFA ·{" "}
                {r.format_terrain === "moitie" ? "Moitié" : "Entier"}
              </p>
              <div className="mt-3 flex items-center gap-2">
                {r.statut === "confirme" && (
                  <button
                    type="button"
                    onClick={() => handleMatchJoue(r.id)}
                    className="min-h-[44px] px-4 rounded-[var(--radius-sm)] bg-[var(--color-primary)] text-white text-xs font-medium"
                  >
                    Match joué
                  </button>
                )}
              </div>
            </article>
          );
        })}
        {filtered.length === 0 && (
          <p className="text-sm text-[var(--color-text-muted)] text-center py-8">
            Aucune réservation
          </p>
        )}
      </div>

      {/* Desktop table */}
      <div className="hidden md:block overflow-x-auto rounded-[var(--radius-md)] border border-[var(--color-border)] bg-white">
        <table className="bo-table">
          <thead>
            <tr>
              <th>Joueur</th>
              <th>Date</th>
              <th>Heure</th>
              <th>Montant</th>
              <th>Statut</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r: any) => {
              const meta = statusMeta[r.statut] || statusMeta.en_attente;
              return (
                <tr key={r.id}>
                  <td className="font-medium">{r.joueur_nom}</td>
                  <td>{r.date}</td>
                  <td>
                    {r.heure_debut}–{r.heure_fin}
                  </td>
                  <td className="font-semibold text-[var(--color-primary)]">
                    {(r.montant || 0).toLocaleString()} CFA
                  </td>
                  <td>
                    <span className={`text-[10px] font-medium px-2.5 py-1 rounded-full ${meta.badge}`}>
                      {meta.label}
                    </span>
                  </td>
                  <td>
                    {r.statut === "confirme" ? (
                      <button
                        type="button"
                        onClick={() => handleMatchJoue(r.id)}
                        className="text-xs font-medium text-[var(--color-primary)] hover:underline"
                      >
                        Match joué
                      </button>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center text-[var(--color-text-muted)] py-8">
                  Aucune réservation
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Réservation manuelle */}
      <section>
        <h2 className="section-title mb-4">Réservation manuelle</h2>
        <form
          className="bg-white rounded-[var(--radius-lg)] border border-[var(--color-border)] p-5 sm:p-6 grid grid-cols-1 sm:grid-cols-2 gap-4 shadow-sm"
          onSubmit={handleSubmit}
        >
          <div className="sm:col-span-1">
            <label className="text-xs font-medium text-[var(--color-text-secondary)] mb-1.5 block">
              Nom du joueur
            </label>
            <input
              required
              placeholder="Amadou Diallo"
              value={manual.joueur_nom}
              onChange={(e) => setManual({ ...manual, joueur_nom: e.target.value })}
              className="w-full h-[52px] rounded-[var(--radius-md)] border border-[var(--color-border)] px-4 text-sm outline-none focus:border-[var(--color-primary)]"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-[var(--color-text-secondary)] mb-1.5 block">
              Téléphone
            </label>
            <input
              required
              type="tel"
              placeholder="+221 77 000 00 00"
              value={manual.joueur_telephone}
              onChange={(e) => setManual({ ...manual, joueur_telephone: e.target.value })}
              className="w-full h-[52px] rounded-[var(--radius-md)] border border-[var(--color-border)] px-4 text-sm outline-none focus:border-[var(--color-primary)]"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-[var(--color-text-secondary)] mb-1.5 block">
              Format
            </label>
            <select
              className="w-full h-[52px] rounded-[var(--radius-md)] border border-[var(--color-border)] px-4 text-sm bg-white"
              value={manual.format_terrain}
              onChange={(e) =>
                setManual({ ...manual, format_terrain: e.target.value as "moitie" | "entier" })
              }
            >
              <option value="moitie">Moitié du terrain</option>
              <option value="entier">Terrain entier</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-[var(--color-text-secondary)] mb-1.5 block">
              Date
            </label>
            <input
              required
              type="date"
              value={manual.date}
              onChange={(e) => setManual({ ...manual, date: e.target.value })}
              className="w-full h-[52px] rounded-[var(--radius-md)] border border-[var(--color-border)] px-4 text-sm outline-none focus:border-[var(--color-primary)]"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-[var(--color-text-secondary)] mb-1.5 block">
              Créneau — début
            </label>
            <input
              required
              type="time"
              value={manual.heure_debut}
              onChange={(e) => setManual({ ...manual, heure_debut: e.target.value })}
              className="w-full h-[52px] rounded-[var(--radius-md)] border border-[var(--color-border)] px-4 text-sm outline-none focus:border-[var(--color-primary)]"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-[var(--color-text-secondary)] mb-1.5 block">
              Créneau — fin
            </label>
            <input
              required
              type="time"
              value={manual.heure_fin}
              onChange={(e) => setManual({ ...manual, heure_fin: e.target.value })}
              className="w-full h-[52px] rounded-[var(--radius-md)] border border-[var(--color-border)] px-4 text-sm outline-none focus:border-[var(--color-primary)]"
            />
          </div>
          <button
            type="submit"
            disabled={manualLoading}
            className="sm:col-span-2 w-full min-h-[52px] rounded-[var(--radius-md)] bg-[var(--color-primary)] text-white text-sm font-medium hover:bg-[var(--color-primary-light)] disabled:bg-[var(--color-text-muted)]"
          >
            {manualLoading ? "Création..." : "Créer et envoyer le lien de paiement"}
          </button>
        </form>
      </section>
    </div>
  );
}
