import { CheckCircle, Calendar, Clock, MapPin, Users, ArrowRight, Home } from "lucide-react";
import { useNavigate, useLocation, useSearchParams } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/use-auth";

const ReservationConfirmation = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { isAuthenticated } = useAuth() as any;

  const data = location.state;
  const reservationIdFromQuery = useMemo(() => {
    const id = searchParams.get("id");
    return id ? Number(id) : null;
  }, [searchParams]);

  const fallbackData = JSON.parse(localStorage.getItem("terrainsn_last_reservation") || "null");
  const [reservationData, setReservationData] = useState<any>(data || fallbackData);

  useEffect(() => {
    if (!isAuthenticated) {
      navigate("/login");
    }
  }, [isAuthenticated, navigate]);

  useEffect(() => {
    if (data) {
      localStorage.setItem("terrainsn_last_reservation", JSON.stringify(data));
      setReservationData(data);
    }
  }, [data]);

  useEffect(() => {
    const shouldFetch =
      isAuthenticated &&
      reservationIdFromQuery &&
      (!data || !reservationData || (reservationData && !reservationData.terrainNom));

    if (!shouldFetch) return;

    const run = async () => {
      try {
        const token = localStorage.getItem("terrainsn_token");
        const res = await fetch(`/api/reservations/${reservationIdFromQuery}`, {
          method: "GET",
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });

        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || "Erreur");

        const normalized = {
          reservationId: json.id,
          terrainNom: json.terrain_nom,
          terrainVille: json.terrain_ville,
          terrainType: json.terrain_type,
          date: json.date,
          heureDebut: json.heure_debut,
          heureFin: json.heure_fin,
          duree: json.duree,
          montant: json.montant,
          statut: json.statut,
        };

        setReservationData(normalized);
        localStorage.setItem("terrainsn_last_reservation", JSON.stringify(normalized));
      } catch {
        // garde fallback localStorage
      }
    };

    run();
  }, [isAuthenticated, reservationIdFromQuery, data, reservationData]);

  if (!reservationData) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center px-4" style={{ background: "#F0F7F4" }}>
        <div className="text-center">
          <p className="text-[var(--color-text-secondary)] mb-4 text-sm">Aucune réservation trouvée</p>
          <button
            type="button"
            onClick={() => navigate("/explorer")}
            className="min-h-[52px] px-6 rounded-[var(--radius-md)] bg-[var(--color-primary)] text-white text-sm font-medium"
          >
            Explorer les terrains
          </button>
        </div>
      </div>
    );
  }

  const {
    terrainNom,
    terrainType,
    terrainVille,
    date,
    heureDebut,
    heureFin,
    duree,
    montant,
    statut,
    reservationId,
  } = reservationData;

  const statusConfig: Record<string, { label: string; className: string }> = {
    en_attente: {
      label: "En attente de confirmation",
      className: "bg-[color-mix(in_srgb,var(--color-warning)_16%,white)] text-[var(--color-warning)]",
    },
    acceptee: {
      label: "Confirmée",
      className: "bg-[color-mix(in_srgb,var(--color-success)_14%,white)] text-[var(--color-success)]",
    },
    confirme: {
      label: "Confirmée",
      className: "bg-[color-mix(in_srgb,var(--color-success)_14%,white)] text-[var(--color-success)]",
    },
    joue: {
      label: "Jouée",
      className: "bg-[var(--color-primary)] text-white",
    },
    refusee: {
      label: "Refusée",
      className: "bg-[color-mix(in_srgb,var(--color-danger)_12%,white)] text-[var(--color-danger)]",
    },
    annulee: {
      label: "Annulée",
      className: "bg-[var(--color-surface-2)] text-[var(--color-text-muted)]",
    },
    annule: {
      label: "Annulée",
      className: "bg-[var(--color-surface-2)] text-[var(--color-text-muted)]",
    },
  };

  const currentStatus = statusConfig[statut] || statusConfig.en_attente;
  const code = reservationId != null ? String(reservationId).padStart(6, "0") : "------";

  return (
    <div className="page-container !pt-0" style={{ background: "#F0F7F4" }}>
      <div className="responsive-padding pt-10 pb-8">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-[color-mix(in_srgb,var(--color-primary)_14%,white)] mb-5 animate-[checkPop_0.55s_ease]">
            <CheckCircle className="w-10 h-10 text-[var(--color-primary)]" strokeWidth={2} />
          </div>
          <h1
            className="text-2xl sm:text-3xl font-semibold text-[var(--color-text-primary)] mb-2"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Réservation confirmée
          </h1>
          <p className="text-sm text-[var(--color-text-secondary)]">
            Votre créneau est enregistré. Conservez votre code.
          </p>
        </div>

        <div className="max-w-md mx-auto">
          <div className="flex justify-center mb-5">
            <span
              className={`inline-flex items-center px-4 py-2 rounded-full text-sm font-medium ${currentStatus.className}`}
            >
              {currentStatus.label}
            </span>
          </div>

          <div className="bg-[var(--surface)] rounded-[var(--radius-lg)] border border-[var(--color-border)] p-5 mb-4 shadow-sm">
            <div className="mb-4">
              <h2
                className="text-lg font-semibold text-[var(--color-text-primary)]"
                style={{ fontFamily: "var(--font-display)" }}
              >
                {terrainNom}
              </h2>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--color-text-muted)] mt-1">
                <span className="inline-flex items-center gap-1">
                  <MapPin className="w-3 h-3" />
                  {terrainVille}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Users className="w-3 h-3" />
                  {terrainType}
                </span>
              </div>
            </div>

            <div className="border-t border-[var(--color-border)] pt-4 space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-[var(--radius-sm)] bg-[var(--color-surface-2)] flex items-center justify-center">
                  <Calendar className="w-4 h-4 text-[var(--color-text-secondary)]" />
                </div>
                <div>
                  <p className="text-[11px] text-[var(--color-text-muted)]">Date</p>
                  <p className="text-sm font-medium">{date}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-[var(--radius-sm)] bg-[var(--color-surface-2)] flex items-center justify-center">
                  <Clock className="w-4 h-4 text-[var(--color-text-secondary)]" />
                </div>
                <div>
                  <p className="text-[11px] text-[var(--color-text-muted)]">Heure</p>
                  <p className="text-sm font-medium">
                    {heureDebut} – {heureFin} ({duree}h)
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-5 pt-4 border-t border-[var(--color-border)] text-center">
              <p className="text-[11px] uppercase tracking-wide text-[var(--color-text-muted)] mb-1">
                Code réservation
              </p>
              <p
                className="text-3xl font-semibold tracking-[0.12em] text-[var(--color-primary)]"
                style={{ fontFamily: "var(--font-display)" }}
              >
                {code}
              </p>
            </div>

            <div className="mt-4 flex items-center justify-between">
              <span className="text-sm text-[var(--color-text-muted)]">Montant</span>
              <span
                className="text-xl font-semibold text-[var(--color-primary)]"
                style={{ fontFamily: "var(--font-display)" }}
              >
                {montant?.toLocaleString() || 0} CFA
              </span>
            </div>
          </div>

          <div className="space-y-3">
            <button
              type="button"
              className="w-full min-h-[52px] rounded-[var(--radius-md)] bg-[var(--color-primary)] text-white text-sm font-medium inline-flex items-center justify-center gap-2 hover:bg-[var(--color-primary-light)]"
              onClick={() => navigate("/reservations")}
            >
              Voir mes réservations
              <ArrowRight className="w-4 h-4" />
            </button>
            <button
              type="button"
              className="w-full min-h-[52px] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--surface)] text-sm font-medium inline-flex items-center justify-center gap-2 text-[var(--color-text-primary)]"
              onClick={() => navigate("/")}
            >
              <Home className="w-4 h-4" />
              Retour à l&apos;accueil
            </button>
          </div>

          {statut === "en_attente" && (
            <div className="mt-6 p-4 rounded-[var(--radius-md)] bg-[var(--surface)] border border-[var(--color-border)]">
              <p className="text-xs text-[var(--color-text-secondary)] text-center leading-relaxed">
                Vous recevrez une notification WhatsApp lorsque le gérant confirmera votre réservation.
              </p>
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes checkPop {
          0% { transform: scale(0.6); opacity: 0; }
          70% { transform: scale(1.08); opacity: 1; }
          100% { transform: scale(1); }
        }
      `}</style>
    </div>
  );
};

export default ReservationConfirmation;
