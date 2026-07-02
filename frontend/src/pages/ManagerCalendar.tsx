import { useState, useEffect } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, Clock, User, XCircle, AlertCircle, CheckCircle2, Phone, Calendar, MapPin } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
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
import { Badge } from "@/components/ui/badge";

const statusConfig: Record<string, { label: string; className: string }> = {
  en_attente: { label: "En attente", className: "bg-secondary/20 text-secondary-foreground" },
  acceptee: { label: "Acceptée", className: "bg-accent text-accent-foreground" },
  refusee: { label: "Refusée", className: "bg-destructive/10 text-destructive" },
  annulee: { label: "Annulée", className: "bg-muted text-muted-foreground" },
};

const ManagerCalendar = () => {
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();
  const [loading, setLoading] = useState(true);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [reservations, setReservations] = useState<any[]>([]);
  const [blocages, setBlocages] = useState<any[]>([]);
  const [horaires, setHoraires] = useState<any[]>([]);
  
  // Modal states
  const [selectedReservation, setSelectedReservation] = useState<any>(null);
  const [selectedBlocage, setSelectedBlocage] = useState<any>(null);
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    if (!isAuthenticated || (user?.role !== 'employe' && user?.accountType !== 'employe')) {
      navigate('/connexion');
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
    } catch (err: any) {
      toast.error(err.message || "Erreur lors du chargement");
    } finally {
      setLoading(false);
    }
  };

  // Get start of week (Monday)
  const getStartOfWeek = (date: Date) => {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    return new Date(d.setDate(diff));
  };

  const startOfWeek = getStartOfWeek(currentDate);
  
  // Generate week days
  const weekDays = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(startOfWeek);
    d.setDate(d.getDate() + i);
    weekDays.push(d);
  }

  // Generate time slots (8h to 22h)
  const timeSlots = [];
  for (let h = 8; h <= 22; h++) {
    timeSlots.push(`${h.toString().padStart(2, '0')}:00`);
  }

  const formatDate = (date: Date) => {
    return date.toISOString().split('T')[0];
  };

  const formatDay = (date: Date) => {
    const days = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
    return `${days[date.getDay()]} ${date.getDate()}`;
  };

  const isToday = (date: Date) => {
    const today = new Date();
    return date.getDate() === today.getDate() &&
           date.getMonth() === today.getMonth() &&
           date.getFullYear() === today.getFullYear();
  };

  // Get slot status
  const getSlotStatus = (date: Date, time: string) => {
    const dateStr = formatDate(date);
    
    // Check if blocked
    const blocage = blocages.find(b => 
      b.date === dateStr && 
      time >= b.heure_debut && 
      time < b.heure_fin
    );
    if (blocage) return { status: 'blocked', data: blocage };
    
    // Check if reserved
    const reservation = reservations.find(r => 
      r.date === dateStr && 
      time >= r.heure_debut && 
      time < r.heure_fin
    );
    if (reservation) return { status: 'reserved', data: reservation };
    
    return { status: 'free', data: null };
  };

  const getSlotColor = (status: string) => {
    switch (status) {
      case 'free': return 'bg-accent/10 border-accent/20 hover:bg-accent/20';
      case 'reserved': return 'bg-secondary/20 border-secondary/30 hover:bg-secondary/30';
      case 'blocked': return 'bg-destructive/10 border-destructive/20 hover:bg-destructive/20';
      default: return 'bg-muted border-border';
    }
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
  };

  const handleSlotClick = (date: Date, time: string, slotInfo: any) => {
    if (slotInfo.status === 'reserved' && slotInfo.data) {
      setSelectedReservation(slotInfo.data);
    } else if (slotInfo.status === 'blocked' && slotInfo.data) {
      setSelectedBlocage(slotInfo.data);
    }
  };

  const handleTraiterReservation = async (id: number, action: 'acceptee' | 'refusee') => {
    setProcessing(true);
    try {
      await reservationsApi.traiter(id, action);
      setReservations(prev => prev.map(r => r.id === id ? { ...r, statut: action } : r));
      setSelectedReservation(null);
      toast.success(`Réservation ${action === 'acceptee' ? 'acceptée' : 'refusée'}`);
    } catch (err: any) {
      toast.error(err.message || "Erreur lors du traitement");
    } finally {
      setProcessing(false);
    }
  };

  const getBlocageLabel = (motif: string) => {
    const labels: Record<string, string> = {
      entretien: 'Entretien',
      maintenance: 'Maintenance',
      evenement_prive: 'Événement privé',
      meteo: 'Météo',
    };
    return labels[motif] || 'Bloqué';
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Chargement...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="bg-foreground responsive-padding pt-5 pb-4 rounded-b-3xl">
          <div className="flex items-center justify-between mb-4">
            <button 
              onClick={() => navigate("/gerant")} 
              className="bg-background/20 rounded-full p-2"
            >
              <ArrowLeft className="w-5 h-5 text-background" />
            </button>
            <span className="font-display font-bold text-background text-sm sm:text-base">
              📅 Calendrier du terrain
            </span>
            <div className="w-9" />
          </div>

          {/* Navigation */}
          <div className="flex items-center justify-between">
            <Button
              variant="outline"
              size="sm"
              onClick={handlePrevWeek}
              className="bg-background/10 border-background/20 text-background"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <div className="text-center">
              <p className="font-display font-bold text-background text-sm sm:text-base">
                {startOfWeek.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}
              </p>
              <p className="text-background/60 text-xs">
                Semaine du {startOfWeek.getDate()} au {weekDays[6].getDate()}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleNextWeek}
              className="bg-background/10 border-background/20 text-background"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Controls */}
        <div className="responsive-padding mt-4">
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleToday}
              className="flex-1"
            >
              Aujourd'hui
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate("/gerant")}
              className="flex-1"
            >
              Retour gestion
            </Button>
          </div>
        </div>

        {/* Legend */}
        <div className="responsive-padding mt-4">
          <div className="flex gap-4 text-xs">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded bg-accent/20 border border-accent/30" />
              <span>Libre</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded bg-secondary/20 border border-secondary/30" />
              <span>Réservé</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded bg-destructive/10 border border-destructive/20" />
              <span>Bloqué</span>
            </div>
          </div>
        </div>

        {/* Calendar Grid */}
        <div className="responsive-padding mt-4">
          <div className="bg-card rounded-2xl border border-border overflow-hidden">
            {/* Days header */}
            <div className="grid grid-cols-8 border-b border-border bg-muted/30">
              <div className="p-3 text-xs font-medium text-muted-foreground border-r border-border">
                Heure
              </div>
              {weekDays.map((day, idx) => (
                <div 
                  key={idx}
                  className={`p-3 text-center border-r border-border last:border-r-0 ${
                    isToday(day) ? 'bg-primary/10' : ''
                  }`}
                >
                  <p className={`text-xs font-medium ${isToday(day) ? 'text-primary' : 'text-muted-foreground'}`}>
                    {formatDay(day)}
                  </p>
                </div>
              ))}
            </div>

            {/* Time slots grid */}
            <div className="max-h-[60vh] overflow-y-auto">
              {timeSlots.map((time) => (
                <div key={time} className="grid grid-cols-8 border-b border-border last:border-b-0">
                  {/* Time label */}
                  <div className="p-2 text-xs font-medium text-muted-foreground border-r border-border flex items-center justify-center bg-muted/20">
                    {time}
                  </div>
                  
                  {/* Day slots */}
                  {weekDays.map((day, idx) => {
                    const { status, data } = getSlotStatus(day, time);
                    return (
                      <div
                        key={idx}
                        className={`p-1 border-r border-border last:border-r-0 cursor-pointer transition-colors ${
                          getSlotColor(status)
                        }`}
                        onClick={() => handleSlotClick(day, time, { status, data })}
                      >
                        <div className="h-full min-h-[40px] rounded-lg flex flex-col items-center justify-center gap-1">
                          {status === 'reserved' && (
                            <>
                              <User className="w-3 h-3 text-secondary" />
                              <span className="text-[10px] font-medium text-secondary-foreground truncate w-full text-center">
                                {data?.joueur_nom?.split(' ')[0]}
                              </span>
                            </>
                          )}
                          {status === 'blocked' && (
                            <>
                              <XCircle className="w-3 h-3 text-destructive" />
                              <span className="text-[10px] font-medium text-destructive truncate w-full text-center">
                                {data?.motif === 'entretien' ? 'Entretien' : 
                                 data?.motif === 'maintenance' ? 'Maintenance' : 
                                 data?.motif === 'evenement_prive' ? 'Événement' :
                                 data?.motif === 'meteo' ? 'Météo' : 'Bloqué'}
                              </span>
                            </>
                          )}
                          {status === 'free' && (
                            <span className="text-[10px] text-muted-foreground">Libre</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Stats summary */}
        <div className="responsive-padding mt-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="stat-card text-center">
              <p className="text-2xl font-display font-bold text-accent">
                {reservations.filter(r => {
                  const rDate = new Date(r.date);
                  return rDate >= startOfWeek && rDate <= weekDays[6];
                }).length}
              </p>
              <p className="text-xs text-muted-foreground">Réservations</p>
            </div>
            <div className="stat-card text-center">
              <p className="text-2xl font-display font-bold text-destructive">
                {blocages.filter(b => {
                  const bDate = new Date(b.date);
                  return bDate >= startOfWeek && bDate <= weekDays[6];
                }).length}
              </p>
              <p className="text-xs text-muted-foreground">Créneaux bloqués</p>
            </div>
            <div className="stat-card text-center">
              <p className="text-2xl font-display font-bold text-primary">
                {weekDays.length * timeSlots.length - 
                 reservations.filter(r => {
                   const rDate = new Date(r.date);
                   return rDate >= startOfWeek && rDate <= weekDays[6];
                 }).length - 
                 blocages.filter(b => {
                   const bDate = new Date(b.date);
                   return bDate >= startOfWeek && bDate <= weekDays[6];
                 }).length}
              </p>
              <p className="text-xs text-muted-foreground">Créneaux libres</p>
            </div>
          </div>
        </div>
      </div>

      {/* Reservation Detail Modal */}
      <Dialog open={!!selectedReservation} onOpenChange={() => setSelectedReservation(null)}>
        <DialogContent className="max-w-md mx-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Calendar className="w-5 h-5" />
              Détails de la réservation
            </DialogTitle>
            <DialogDescription>
              Informations complètes sur cette réservation
            </DialogDescription>
          </DialogHeader>
          {selectedReservation && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <User className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="font-semibold">{selectedReservation.joueur_nom}</p>
                  {selectedReservation.joueur_telephone && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Phone className="w-3 h-3" /> {selectedReservation.joueur_telephone}
                    </p>
                  )}
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-3 p-3 bg-muted rounded-lg">
                <div>
                  <p className="text-[10px] text-muted-foreground">Date</p>
                  <p className="text-sm font-medium">{selectedReservation.date}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">Horaire</p>
                  <p className="text-sm font-medium">{selectedReservation.heure_debut} - {selectedReservation.heure_fin}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">Terrain</p>
                  <p className="text-sm font-medium truncate">{selectedReservation.terrain_nom}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">Montant</p>
                  <p className="text-sm font-medium text-primary">{(selectedReservation.montant || 0).toLocaleString()} CFA</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Statut :</span>
                <Badge className={statusConfig[selectedReservation.statut]?.className || ''}>
                  {statusConfig[selectedReservation.statut]?.label || selectedReservation.statut}
                </Badge>
              </div>

              {selectedReservation.statut === 'en_attente' && (
                <DialogFooter className="flex gap-2 sm:gap-0">
                  <Button 
                    variant="outline" 
                    className="flex-1 text-destructive border-destructive/20"
                    onClick={() => handleTraiterReservation(selectedReservation.id, 'refusee')}
                    disabled={processing}
                  >
                    Refuser
                  </Button>
                  <Button 
                    variant="hero" 
                    className="flex-1"
                    onClick={() => handleTraiterReservation(selectedReservation.id, 'acceptee')}
                    disabled={processing}
                  >
                    {processing ? 'Traitement...' : 'Accepter'}
                  </Button>
                </DialogFooter>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Blocage Detail Modal */}
      <Dialog open={!!selectedBlocage} onOpenChange={() => setSelectedBlocage(null)}>
        <DialogContent className="max-w-md mx-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <XCircle className="w-5 h-5 text-destructive" />
              Créneau bloqué
            </DialogTitle>
            <DialogDescription>
              Ce créneau n'est pas disponible
            </DialogDescription>
          </DialogHeader>
          {selectedBlocage && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 p-3 bg-muted rounded-lg">
                <div>
                  <p className="text-[10px] text-muted-foreground">Date</p>
                  <p className="text-sm font-medium">{selectedBlocage.date}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">Horaire</p>
                  <p className="text-sm font-medium">{selectedBlocage.heure_debut} - {selectedBlocage.heure_fin}</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Motif :</span>
                <Badge variant="destructive">
                  {getBlocageLabel(selectedBlocage.motif)}
                </Badge>
              </div>

              {selectedBlocage.description && (
                <div className="p-3 bg-muted/50 rounded-lg">
                  <p className="text-xs text-muted-foreground">Description :</p>
                  <p className="text-sm">{selectedBlocage.description}</p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ManagerCalendar;
