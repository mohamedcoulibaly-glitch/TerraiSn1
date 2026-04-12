import { ArrowLeft, Calendar, Clock, CheckCircle2, XCircle, AlertCircle, Save } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { gerantApi, reservationsApi } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const ManagerDashboard = () => {
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();
  const [dashboard, setDashboard] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [horaires, setHoraires] = useState<any[]>([]);
  const [savingHoraires, setSavingHoraires] = useState(false);

  useEffect(() => {
    if (!isAuthenticated || (user?.role !== 'employe' && user?.accountType !== 'employe')) {
      navigate('/connexion');
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

  const handleTraiter = async (id: number, action: 'acceptee' | 'refusee') => {
    try {
      await reservationsApi.traiter(id, action);
      setDashboard((prev: any) => ({
        ...prev,
        reservations: prev.reservations.map((r: any) => r.id === id ? { ...r, statut: action } : r),
      }));
      toast.success(`Réservation ${action === 'acceptee' ? 'validée' : 'refusée'}`);
    } catch (err: any) {
      toast.error(err.message);
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

  const updateHoraire = (index: number, field: string, value: string) => {
    setHoraires(prev => prev.map((h, i) => i === index ? { ...h, [field]: value } : h));
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Chargement...</div>
      </div>
    );
  }

  const jourLabels: Record<string, string> = {
    lundi: 'Lundi', mardi: 'Mardi', mercredi: 'Mercredi', jeudi: 'Jeudi',
    vendredi: 'Vendredi', samedi: 'Samedi', dimanche: 'Dimanche'
  };

  const todayReservations = dashboard?.reservations || [];
  const pendingCount = todayReservations.filter((r: any) => r.statut === 'en_attente').length;
  const blockedSlots = dashboard?.blocages || [];

  return (
    <div className="min-h-screen bg-background pb-8">
      <div className="max-w-4xl mx-auto">
        {/* En-tête */}
        <div className="bg-foreground responsive-padding pt-5 pb-6 rounded-b-3xl">
          <div className="flex items-center justify-between mb-3">
            <button onClick={() => navigate("/proprietaire")} className="bg-background/20 rounded-full p-2">
              <ArrowLeft className="w-5 h-5 text-background" />
            </button>
            <span className="font-display font-bold text-background text-sm sm:text-base">⚙️ Gestion du terrain</span>
            <div className="w-9" />
          </div>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-primary flex items-center justify-center">
              <span className="font-display font-bold text-primary-foreground text-lg">{dashboard?.monthReservations || 0}</span>
            </div>
            <div>
              <p className="text-background/60 text-[10px] sm:text-xs">Réservations ce mois</p>
              <p className="font-display font-bold text-background text-sm sm:text-base">{dashboard?.terrain?.nom || 'Mon terrain'}</p>
            </div>
          </div>
          {pendingCount > 0 && (
            <div className="mt-3 bg-primary rounded-xl p-3 flex items-center justify-between">
              <span className="text-primary-foreground text-xs sm:text-sm font-medium">{pendingCount} réservation(s) en attente</span>
            </div>
          )}
        </div>

        {/* Réservations du jour */}
        <section className="responsive-padding mt-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="section-title">📅 Réservations</h2>
            <span className="bg-secondary/20 text-secondary-foreground text-[10px] sm:text-xs font-bold px-2 py-0.5 rounded-full">
              {todayReservations.length}
            </span>
          </div>
          <div className="flex flex-col sm:grid sm:grid-cols-2 gap-2">
            {todayReservations.map((r: any) => (
              <div key={r.id} className="stat-card flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                  r.statut === "acceptee" ? "bg-accent" : r.statut === "en_attente" ? "bg-secondary/20" : "bg-destructive/10"
                }`}>
                  {r.statut === "acceptee" ? <CheckCircle2 className="w-5 h-5 text-accent-foreground" /> :
                   r.statut === "en_attente" ? <AlertCircle className="w-5 h-5 text-secondary" /> :
                   <XCircle className="w-5 h-5 text-destructive" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-display font-semibold text-xs sm:text-sm">{r.joueur_nom}</p>
                  <div className="flex items-center gap-2 text-[10px] sm:text-xs text-muted-foreground">
                    <span className="flex items-center gap-0.5"><Clock className="w-3 h-3" />{r.heure_debut}-{r.heure_fin}</span>
                    <span>{(r.montant || 0).toLocaleString()} CFA</span>
                  </div>
                </div>
                {r.statut === "en_attente" && (
                  <div className="flex gap-1.5">
                    <Button size="sm" variant="hero" className="h-7 text-[10px] px-2" onClick={() => handleTraiter(r.id, 'acceptee')}>Valider</Button>
                    <Button size="sm" variant="outline" className="h-7 text-[10px] px-2" onClick={() => handleTraiter(r.id, 'refusee')}>Refuser</Button>
                  </div>
                )}
              </div>
            ))}
            {todayReservations.length === 0 && (
              <p className="text-sm text-muted-foreground col-span-full text-center py-4">Aucune réservation</p>
            )}
          </div>
        </section>

        {/* Créneaux bloqués */}
        <section className="responsive-padding mt-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="section-title">🚫 Créneaux bloqués</h2>
            <Button size="sm" variant="outline" className="h-7 text-[10px] sm:text-xs">+ Bloquer</Button>
          </div>
          <div className="flex flex-col sm:grid sm:grid-cols-2 gap-2">
            {blockedSlots.map((slot: any) => (
              <div key={slot.id} className="stat-card flex items-center gap-3 border-l-4 border-destructive">
                <div className="flex-1">
                  <p className="font-display font-semibold text-xs sm:text-sm">{slot.date}</p>
                  <p className="text-[10px] sm:text-xs text-muted-foreground">{slot.heure_debut} - {slot.heure_fin} · {slot.motif}</p>
                </div>
                <Button size="sm" variant="ghost" className="h-7 text-destructive text-[10px] sm:text-xs" onClick={() => handleDeleteBlocage(slot.id)}>Supprimer</Button>
              </div>
            ))}
            {blockedSlots.length === 0 && (
              <p className="text-sm text-muted-foreground col-span-full text-center py-4">Aucun créneau bloqué</p>
            )}
          </div>
        </section>

        {/* Horaires d'ouverture */}
        <section className="responsive-padding mt-5">
          <h2 className="section-title mb-3">🕐 Horaires d'ouverture</h2>
          <div className="stat-card">
            {horaires.map((h, index) => (
              <div key={h.jour} className="flex items-center justify-between py-2 border-b border-border/30 last:border-0">
                <span className="text-xs sm:text-sm font-medium w-20 sm:w-28">{jourLabels[h.jour] || h.jour}</span>
                <div className="flex items-center gap-2">
                  <input
                    type="time"
                    value={h.heure_debut}
                    onChange={(e) => updateHoraire(index, 'heure_debut', e.target.value)}
                    className="bg-muted rounded-lg px-2 py-1 text-xs sm:text-sm w-24 sm:w-28"
                  />
                  <span className="text-muted-foreground text-xs">→</span>
                  <input
                    type="time"
                    value={h.heure_fin}
                    onChange={(e) => updateHoraire(index, 'heure_fin', e.target.value)}
                    className="bg-muted rounded-lg px-2 py-1 text-xs sm:text-sm w-24 sm:w-28"
                  />
                </div>
              </div>
            ))}
            <Button
              variant="hero"
              className="w-full mt-3 h-10 gap-2 text-sm"
              onClick={handleSaveHoraires}
              disabled={savingHoraires}
            >
              <Save className="w-4 h-4" /> {savingHoraires ? 'Sauvegarde...' : 'Enregistrer les horaires'}
            </Button>
          </div>
        </section>

        {/* Actions rapides */}
        <section className="responsive-padding mt-5">
          <div className="bg-foreground rounded-2xl p-4">
            <h3 className="font-display font-bold text-sm sm:text-base text-background mb-3">Actions rapides</h3>
            <div className="flex flex-col sm:flex-row gap-2">
              <Button variant="outline" size="sm" className="bg-background/10 border-background/20 text-background text-xs sm:text-sm justify-start gap-2 flex-1">
                <Calendar className="w-3 h-3" /> Voir le calendrier complet
              </Button>
              <Button variant="outline" size="sm" className="bg-background/10 border-background/20 text-background text-xs sm:text-sm justify-start gap-2 flex-1" onClick={() => navigate("/proprietaire")}>
                <Clock className="w-3 h-3" /> Dashboard propriétaire
              </Button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

export default ManagerDashboard;
