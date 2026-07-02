import { CheckCircle, Calendar, Clock, MapPin, Users, ArrowRight, Home } from "lucide-react";
import { useNavigate, useLocation, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/use-auth";

const ReservationConfirmation = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { isAuthenticated, getToken } = useAuth() as any;

  const data = location.state;
  const reservationIdFromQuery = useMemo(() => {
    const id = searchParams.get("id");
    return id ? Number(id) : null;
  }, [searchParams]);

  // Fallback data for direct access - try to get from localStorage
  const fallbackData = JSON.parse(localStorage.getItem('terrainsn_last_reservation') || 'null');

  const [reservationData, setReservationData] = useState<any>(data || fallbackData);

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/connexion');
    }
  }, [isAuthenticated, navigate]);

  // Store reservation data in localStorage for fallback
  useEffect(() => {
    if (data) {
      localStorage.setItem('terrainsn_last_reservation', JSON.stringify(data));
      setReservationData(data);
    }
  }, [data]);

  // Recharge depuis le backend si accès direct (id en query) et pas de state fiable
  useEffect(() => {
    const shouldFetch =
      isAuthenticated &&
      reservationIdFromQuery &&
      (!data || !reservationData || (reservationData && !reservationData.terrainNom));

    if (!shouldFetch) return;

    const run = async () => {
      try {
        const token = localStorage.getItem('terrainsn_token');
        const res = await fetch(`/api/reservations/${reservationIdFromQuery}`, {
          method: 'GET',
          headers: token ? { 'Authorization': `Bearer ${token}` } : undefined,
        });

        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || 'Erreur');

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
        localStorage.setItem('terrainsn_last_reservation', JSON.stringify(normalized));
      } catch {
        // Si ça échoue, on garde fallback localStorage
      }
    };

    run();
  }, [isAuthenticated, reservationIdFromQuery, data, reservationData]);

  if (!reservationData) {
    return (
      <div className="page-container flex items-center justify-center min-h-screen">
        <div className="text-center">
          <p className="text-muted-foreground mb-4">Aucune réservation trouvée</p>
          <Button onClick={() => navigate("/explorer")}>
            Explorer les terrains
          </Button>
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

  const statusConfig: Record<string, { label: string; className: string; icon: string }> = {
    en_attente: { label: "En attente de confirmation", className: "bg-secondary/20 text-secondary-foreground", icon: "⏳" },
    acceptee: { label: "Confirmée", className: "bg-accent text-accent-foreground", icon: "✅" },
    refusee: { label: "Refusée", className: "bg-destructive/10 text-destructive", icon: "❌" },
    annulee: { label: "Annulée", className: "bg-muted text-muted-foreground", icon: "🚫" },
  };

  const currentStatus = statusConfig[statut] || statusConfig.en_attente;

  const defaultImages = [
    '/src/assets/field-1.jpg',
    '/src/assets/field-2.jpg',
    '/src/assets/field-3.jpg',
    '/src/assets/field-4.jpg',
  ];
  const terrainImage = defaultImages[Math.floor(Math.random() * defaultImages.length)];

  return (
    <div className="page-container">
      <div className="responsive-padding pt-8 pb-4">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-accent/20 mb-4 animate-in zoom-in duration-500">
            <CheckCircle className="w-8 h-8 text-accent" />
          </div>
          <h1 className="font-display font-bold text-2xl sm:text-3xl mb-2">
            Réservation confirmée !
          </h1>
          <p className="text-sm text-muted-foreground">
            Votre réservation a été enregistrée avec succès
          </p>
        </div>

        <div className="max-w-md mx-auto">
          {/* Status Badge */}
          <div className="flex justify-center mb-6">
            <span className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium ${currentStatus.className}`}>
              <span>{currentStatus.icon}</span>
              {currentStatus.label}
            </span>
          </div>

          {/* Reservation Summary Card */}
          <div className="glass-card p-5 mb-4">
            <div className="flex items-center gap-3 mb-4">
              <img
                src={terrainImage}
                alt={terrainNom}
                className="w-16 h-16 rounded-xl object-cover"
              />
              <div className="flex-1 min-w-0">
                <h2 className="font-display font-semibold text-base truncate">
                  {terrainNom}
                </h2>
                <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                  <MapPin className="w-3 h-3" />
                  <span>{terrainVille}</span>
                </div>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Users className="w-3 h-3" />
                  <span>{terrainType}</span>
                </div>
              </div>
            </div>

            <div className="border-t border-border pt-4 space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center">
                  <Calendar className="w-4 h-4 text-muted-foreground" />
                </div>
                <div className="flex-1">
                  <p className="text-xs text-muted-foreground">Date</p>
                  <p className="text-sm font-medium">{date}</p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center">
                  <Clock className="w-4 h-4 text-muted-foreground" />
                </div>
                <div className="flex-1">
                  <p className="text-xs text-muted-foreground">Horaire</p>
                  <p className="text-sm font-medium">
                    {heureDebut} - {heureFin} ({duree}h)
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center">
                  <span className="text-xs font-bold text-muted-foreground">#</span>
                </div>
                <div className="flex-1">
                  <p className="text-xs text-muted-foreground">Réservation</p>
                  <p className="text-sm font-medium">#{reservationId}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Total Amount */}
          <div className="glass-card p-4 mb-6">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Montant payé</span>
              <span className="font-display font-bold text-xl text-primary">
                {montant?.toLocaleString() || 0} CFA
              </span>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="space-y-3">
            <Button
              variant="hero"
              className="w-full h-12 text-base"
              onClick={() => navigate("/reservations")}
            >
              <ArrowRight className="w-4 h-4 mr-2" />
              Voir mes réservations
            </Button>
            <Button
              variant="outline"
              className="w-full h-12 text-base"
              onClick={() => navigate("/")}
            >
              <Home className="w-4 h-4 mr-2" />
              Retour à l'accueil
            </Button>
          </div>

          {/* Info Message */}
          {statut === "en_attente" && (
            <div className="mt-6 p-4 rounded-xl bg-secondary/10 border border-secondary/20">
              <p className="text-xs text-secondary-foreground text-center">
                📱 Vous recevrez une notification WhatsApp lorsque le gérant confirmera votre réservation.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ReservationConfirmation;
