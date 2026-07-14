import {
  TrendingUp,
  Calendar,
  Banknote,
  MapPin,
  Users,
  UserPlus,
  Trash2,
  BarChart3,
} from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useState, useEffect, useMemo } from "react";
import { proprietaireApi, employesApi } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import EmployeeFormModal from "@/espaces/backoffice/components/EmployeeFormModal";
import TerrainFormModal from "@/espaces/backoffice/components/TerrainFormModal";
import FieldPhoto, { resolveTerrainPhoto } from "@/espaces/joueur/components/FieldPhoto";

const OwnerDashboard = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const viewTerrains = searchParams.get("view") === "terrains";
  const { user, isAuthenticated } = useAuth();
  const [stats, setStats] = useState<any>(null);
  const [terrains, setTerrains] = useState<any[]>([]);
  const [employes, setEmployes] = useState<any[]>([]);
  const [reservations, setReservations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showEmployeeModal, setShowEmployeeModal] = useState(false);
  const [showTerrainModal, setShowTerrainModal] = useState(false);

  useEffect(() => {
    if (!isAuthenticated || (user?.role !== "proprietaire" && user?.accountType !== "proprietaire")) {
      navigate("/backoffice/login");
      return;
    }
    loadData();
  }, [isAuthenticated]);

  const loadData = async () => {
    try {
      const [s, t, e, r] = await Promise.all([
        proprietaireApi.stats(),
        proprietaireApi.terrains(),
        employesApi.list(),
        proprietaireApi.reservations(),
      ]);
      setStats(s);
      setTerrains(t);
      setEmployes(e);
      setReservations(r);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteEmploye = async (id: number) => {
    try {
      await employesApi.remove(id);
      setEmployes((prev) => prev.filter((e) => e.id !== id));
      toast.success("Employé supprimé");
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const topTerrain = useMemo(() => {
    const list = stats?.terrainStats || [];
    if (!list.length) return null;
    return [...list].sort((a: any, b: any) => (b.reservations || 0) - (a.reservations || 0))[0];
  }, [stats]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-pulse text-[var(--color-text-secondary)] text-sm">Chargement...</div>
      </div>
    );
  }

  if (viewTerrains) {
    return (
      <div className="space-y-5 max-w-5xl mx-auto">
        <div>
          <h1
            className="text-xl font-semibold text-[var(--color-text-primary)]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Mes terrains
          </h1>
          <p className="text-sm text-[var(--color-text-secondary)] mt-1">
            Vue lecture seule · {terrains.length} terrain{terrains.length > 1 ? "s" : ""}
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {terrains.map((t) => {
            const active = t.is_active === 1 || t.is_active === true || t.is_active === "1";
            return (
              <article
                key={t.id}
                className="bg-white rounded-[var(--radius-lg)] border border-[var(--color-border)] overflow-hidden shadow-sm"
              >
                <FieldPhoto
                  id={t.id}
                  alt={t.nom}
                  src={resolveTerrainPhoto(t)}
                  heightClass="h-[140px]"
                  className="rounded-none"
                />
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3
                        className="font-semibold text-base truncate"
                        style={{ fontFamily: "var(--font-display)" }}
                      >
                        {t.nom}
                      </h3>
                      <p className="text-[13px] text-[var(--color-text-muted)] mt-1 flex items-center gap-1">
                        <MapPin className="w-3.5 h-3.5" />
                        {t.ville || t.quartier || "—"}
                      </p>
                    </div>
                    <span
                      className={`text-[10px] font-medium px-2.5 py-1 rounded-full flex-shrink-0 ${
                        active
                          ? "bg-[color-mix(in_srgb,var(--color-success)_14%,white)] text-[var(--color-success)]"
                          : "bg-[color-mix(in_srgb,var(--color-danger)_12%,white)] text-[var(--color-danger)]"
                      }`}
                    >
                      {active ? "Actif" : "Suspendu"}
                    </span>
                  </div>
                  <p className="mt-3 text-sm font-semibold text-[var(--color-primary)]">
                    {Number(t.prix_entier || t.prix_heure || 0).toLocaleString()} CFA/h
                  </p>
                </div>
              </article>
            );
          })}
          {terrains.length === 0 && (
            <p className="text-sm text-[var(--color-text-muted)] text-center py-10 col-span-full">
              Aucun terrain
            </p>
          )}
        </div>
      </div>
    );
  }

  const pending = reservations.filter((r) => r.statut === "en_attente");

  const statCards = [
    {
      label: "Revenus du mois",
      value: (stats?.totalRevenue || 0).toLocaleString(),
      suffix: "CFA",
      gold: true,
      icon: Banknote,
      tint: "bg-[color-mix(in_srgb,var(--color-accent)_20%,white)] text-[var(--color-accent)]",
    },
    {
      label: "Réservations du mois",
      value: String(stats?.totalReservations || 0),
      icon: Calendar,
      tint: "bg-[color-mix(in_srgb,var(--color-primary)_12%,white)] text-[var(--color-primary)]",
    },
    {
      label: "Taux d'occupation",
      value: `${stats?.occupancyRate || 0}`,
      suffix: "%",
      icon: TrendingUp,
      tint: "bg-[color-mix(in_srgb,var(--color-info)_12%,white)] text-[var(--color-info)]",
    },
    {
      label: "Terrain le plus actif",
      value: topTerrain?.nom || "—",
      small: true,
      icon: MapPin,
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
          Vue d&apos;ensemble de vos terrains
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
              className={`mt-3 leading-tight font-semibold ${
                card.small ? "text-base" : "text-[28px]"
              } ${card.gold ? "text-[var(--color-accent)]" : "text-[var(--color-text-primary)]"}`}
              style={{ fontFamily: "var(--font-display)" }}
            >
              {card.value}
              {card.suffix && !card.small && (
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
          onClick={() => navigate("/backoffice/proprietaire/revenus")}
          className="flex-1 min-h-[48px] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-white text-sm font-medium inline-flex items-center justify-center gap-2"
        >
          <BarChart3 className="w-4 h-4 text-[var(--color-primary)]" />
          Voir les revenus
        </button>
        <button
          type="button"
          onClick={() => navigate("/backoffice/proprietaire?view=terrains")}
          className="flex-1 min-h-[48px] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-white text-sm font-medium inline-flex items-center justify-center gap-2"
        >
          <MapPin className="w-4 h-4 text-[var(--color-primary)]" />
          Mes terrains
        </button>
        <button
          type="button"
          onClick={() => setShowTerrainModal(true)}
          className="flex-1 min-h-[48px] rounded-[var(--radius-md)] bg-[var(--color-primary)] text-white text-sm font-medium inline-flex items-center justify-center gap-2 hover:bg-[var(--color-primary-light)]"
        >
          Ajouter un terrain
        </button>
      </div>

      {pending.length > 0 && (
        <section>
          <h2 className="section-title mb-3">Acomptes en attente</h2>
          <div className="flex flex-col gap-2">
            {pending.slice(0, 5).map((r) => (
              <div
                key={r.id}
                className="bg-white rounded-[var(--radius-md)] border border-[var(--color-border)] border-l-4 border-l-[var(--color-warning)] p-3"
              >
                <p className="font-semibold text-sm" style={{ fontFamily: "var(--font-display)" }}>
                  {r.terrain_nom}
                </p>
                <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                  {r.joueur_nom} · {r.date} · {r.heure_debut}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="section-title">Gérants</h2>
          <button
            type="button"
            onClick={() => setShowEmployeeModal(true)}
            className="inline-flex items-center gap-1.5 px-3 min-h-[40px] rounded-[var(--radius-sm)] border border-[var(--color-border)] text-xs font-medium"
          >
            <UserPlus className="w-3.5 h-3.5" /> Ajouter
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {employes.map((e) => (
            <div
              key={e.id}
              className="bg-white rounded-[var(--radius-md)] border border-[var(--color-border)] p-4"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-[color-mix(in_srgb,var(--color-primary)_12%,white)] flex items-center justify-center">
                  <Users className="w-5 h-5 text-[var(--color-primary)]" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm" style={{ fontFamily: "var(--font-display)" }}>
                    {e.nom}
                  </p>
                  <p className="text-xs text-[var(--color-text-muted)]">{e.telephone}</p>
                </div>
                <button
                  type="button"
                  className="text-[var(--color-danger)]/60 hover:text-[var(--color-danger)] p-2"
                  onClick={() => handleDeleteEmploye(e.id)}
                  aria-label="Supprimer"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              <p className="text-xs text-[var(--color-text-secondary)] mt-3">
                Affecté à :{" "}
                <span className="font-medium text-[var(--color-text-primary)]">
                  {e.terrain_nom || "Non affecté"}
                </span>
              </p>
            </div>
          ))}
          {employes.length === 0 && (
            <p className="text-sm text-[var(--color-text-muted)] text-center py-6 col-span-full">
              Aucun gérant
            </p>
          )}
        </div>
      </section>

      <TerrainFormModal
        open={showTerrainModal}
        onOpenChange={setShowTerrainModal}
        terrain={null}
        onSuccess={loadData}
      />
      <EmployeeFormModal
        open={showEmployeeModal}
        onOpenChange={setShowEmployeeModal}
        onSuccess={loadData}
      />
    </div>
  );
};

export default OwnerDashboard;
