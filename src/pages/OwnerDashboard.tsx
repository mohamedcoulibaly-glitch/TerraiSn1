import {
  ArrowLeft, TrendingUp, DollarSign, Calendar, Clock, Users, BarChart3,
  ChevronRight, Plus, Settings, Building2, UserPlus, Trash2
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { proprietaireApi, employesApi, reservationsApi } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, PieChart, Pie, Cell } from "recharts";

const COLORS = ["hsl(145,63%,30%)", "hsl(42,80%,55%)", "hsl(210,70%,50%)", "hsl(0,72%,51%)"];
const tabs = ["Vue d'ensemble", "Terrains", "Employés", "Réservations"];

const OwnerDashboard = () => {
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();
  const [activeTab, setActiveTab] = useState("Vue d'ensemble");
  const [stats, setStats] = useState<any>(null);
  const [terrains, setTerrains] = useState<any[]>([]);
  const [employes, setEmployes] = useState<any[]>([]);
  const [reservations, setReservations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isAuthenticated || (user?.role !== 'proprietaire' && user?.accountType !== 'proprietaire')) {
      navigate('/connexion');
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
      setEmployes(prev => prev.filter(e => e.id !== id));
      toast.success("Employé supprimé");
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleTraiterReservation = async (id: number, action: 'acceptee' | 'refusee') => {
    try {
      await reservationsApi.traiter(id, action);
      setReservations(prev => prev.map(r => r.id === id ? { ...r, statut: action } : r));
      toast.success(`Réservation ${action === 'acceptee' ? 'acceptée' : 'refusée'}`);
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Chargement du tableau de bord...</div>
      </div>
    );
  }

  const pending = reservations.filter(r => r.statut === 'en_attente');
  const pieData = stats?.terrainStats?.map((t: any) => ({ name: t.nom, value: t.revenue })) || [];
  const weeklyData = stats?.weeklyRevenue || [];

  const defaultImages = ['/src/assets/field-1.jpg', '/src/assets/field-2.jpg', '/src/assets/field-3.jpg', '/src/assets/field-4.jpg'];

  return (
    <div className="min-h-screen bg-background pb-8">
      <div className="max-w-6xl mx-auto">
        {/* En-tête */}
        <div className="bg-primary responsive-padding pt-5 pb-8 rounded-b-3xl">
          <div className="flex items-center justify-between mb-4">
            <button onClick={() => navigate("/")} className="bg-primary-foreground/20 rounded-full p-2">
              <ArrowLeft className="w-5 h-5 text-primary-foreground" />
            </button>
            <span className="font-display font-bold text-primary-foreground text-sm sm:text-base">⚽ TerrainSN</span>
            <button onClick={() => navigate("/gerant")} className="bg-primary-foreground/20 rounded-full p-2">
              <Settings className="w-5 h-5 text-primary-foreground" />
            </button>
          </div>
          <p className="text-primary-foreground/70 text-xs sm:text-sm">Tableau de bord propriétaire</p>
          <h1 className="font-display font-bold text-xl sm:text-2xl lg:text-3xl text-primary-foreground">Bonjour, {user?.nom || 'Propriétaire'}</h1>
          <span className="inline-flex items-center gap-1 bg-primary-foreground/20 text-primary-foreground text-[10px] sm:text-xs px-2.5 py-1 rounded-full mt-2">
            <Building2 className="w-3 h-3" /> Propriétaire
          </span>
        </div>

        {/* Tabs */}
        <div className="responsive-padding -mt-4 relative z-10">
          <div className="flex gap-2 overflow-x-auto scrollbar-hide bg-card rounded-2xl p-1 shadow-sm border border-border/30">
            {tabs.map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-medium transition-colors flex-shrink-0 ${
                  activeTab === tab ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>

        {activeTab === "Vue d'ensemble" && stats && (
          <>
            {/* KPI Cards */}
            <div className="responsive-padding mt-4 grid grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="stat-card">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                    <DollarSign className="w-4 h-4 sm:w-5 sm:h-5 text-primary" />
                  </div>
                  <span className="text-[10px] sm:text-xs text-muted-foreground">Revenus (FCFA)</span>
                </div>
                <p className="font-display font-bold text-lg sm:text-xl">{(stats.totalRevenue || 0).toLocaleString()}</p>
              </div>
              <div className="stat-card">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-accent flex items-center justify-center">
                    <TrendingUp className="w-4 h-4 sm:w-5 sm:h-5 text-accent-foreground" />
                  </div>
                  <span className="text-[10px] sm:text-xs text-muted-foreground">Taux d'occup.</span>
                </div>
                <p className="font-display font-bold text-lg sm:text-xl">{stats.occupancyRate || 0}%</p>
              </div>
              <div className="stat-card">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-secondary/20 flex items-center justify-center">
                    <Calendar className="w-4 h-4 sm:w-5 sm:h-5 text-secondary" />
                  </div>
                  <span className="text-[10px] sm:text-xs text-muted-foreground">Réservations</span>
                </div>
                <p className="font-display font-bold text-lg sm:text-xl">{stats.totalReservations || 0}</p>
              </div>
              <div className="stat-card">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-destructive/10 flex items-center justify-center">
                    <Clock className="w-4 h-4 sm:w-5 sm:h-5 text-destructive" />
                  </div>
                  <span className="text-[10px] sm:text-xs text-muted-foreground">En attente</span>
                </div>
                <p className="font-display font-bold text-lg sm:text-xl">{stats.pendingReservations || 0}</p>
              </div>
            </div>

            {/* Charts */}
            <div className="responsive-padding mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="section-title flex items-center gap-2"><BarChart3 className="w-4 h-4" /> Revenus (7 jours)</h2>
                </div>
                <div className="stat-card">
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={weeklyData}>
                      <XAxis dataKey="day" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                      <YAxis hide />
                      <Tooltip formatter={(value: number) => [`${value.toLocaleString()} CFA`, "Revenu"]} contentStyle={{ borderRadius: 12, fontSize: 12 }} />
                      <Bar dataKey="revenue" fill="hsl(145,63%,30%)" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {pieData.length > 0 && (
                <div>
                  <h2 className="section-title mb-3">🏟️ Répartition par terrain</h2>
                  <div className="stat-card flex flex-col sm:flex-row items-center gap-4">
                    <ResponsiveContainer width={150} height={150}>
                      <PieChart>
                        <Pie data={pieData} cx="50%" cy="50%" innerRadius={40} outerRadius={65} dataKey="value" paddingAngle={3}>
                          {pieData.map((_: any, i: number) => (
                            <Cell key={i} fill={COLORS[i % COLORS.length]} />
                          ))}
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="flex-1 flex flex-col gap-2 w-full">
                      {pieData.map((d: any, i: number) => (
                        <div key={d.name} className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                          <span className="text-xs sm:text-sm truncate flex-1">{d.name}</span>
                          <span className="text-xs sm:text-sm font-bold">{(d.value / 1000).toFixed(0)}k CFA</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Pending Reservations */}
            <section className="responsive-padding mt-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="section-title">🔔 Réservations en attente</h2>
                <span className="bg-destructive text-destructive-foreground text-[10px] sm:text-xs font-bold px-2 py-0.5 rounded-full">
                  {pending.length}
                </span>
              </div>
              <div className="flex flex-col sm:grid sm:grid-cols-2 gap-2">
                {pending.map((r) => (
                  <div key={r.id} className="stat-card flex items-center gap-3">
                    <img src={defaultImages[((r.terrain_id || 1) - 1) % defaultImages.length]} alt={r.terrain_nom} className="w-12 h-12 rounded-xl object-cover flex-shrink-0" loading="lazy" width={48} height={48} />
                    <div className="flex-1 min-w-0">
                      <p className="font-display font-semibold text-xs sm:text-sm truncate">{r.terrain_nom}</p>
                      <p className="text-[10px] sm:text-xs text-muted-foreground">{r.joueur_nom} · {r.date} · {r.heure_debut}</p>
                    </div>
                    <div className="flex gap-1.5">
                      <Button size="sm" variant="hero" className="h-7 text-[10px] sm:text-xs px-2.5" onClick={() => handleTraiterReservation(r.id, 'acceptee')}>Accepter</Button>
                      <Button size="sm" variant="outline" className="h-7 text-[10px] sm:text-xs px-2.5" onClick={() => handleTraiterReservation(r.id, 'refusee')}>Refuser</Button>
                    </div>
                  </div>
                ))}
                {pending.length === 0 && (
                  <p className="text-sm text-muted-foreground col-span-full text-center py-4">Aucune réservation en attente</p>
                )}
              </div>
            </section>
          </>
        )}

        {activeTab === "Terrains" && (
          <section className="responsive-padding mt-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="section-title">Mes terrains</h2>
              <Button size="sm" variant="hero" className="h-8 gap-1 text-xs sm:text-sm">
                <Plus className="w-3 h-3" /> Ajouter un terrain
              </Button>
            </div>

            {stats?.terrainStats && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
                {stats.terrainStats.map((t: any) => (
                  <div key={t.nom} className="stat-card">
                    <h3 className="font-display font-semibold text-sm sm:text-base mb-3">{t.nom}</h3>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="text-center">
                        <p className="font-display font-bold text-lg text-primary">{t.reservations}</p>
                        <p className="text-[10px] sm:text-xs text-muted-foreground">Réserv.</p>
                      </div>
                      <div className="text-center">
                        <p className="font-display font-bold text-lg text-secondary">{(t.revenue / 1000).toFixed(0)}k</p>
                        <p className="text-[10px] sm:text-xs text-muted-foreground">Revenus</p>
                      </div>
                      <div className="text-center">
                        <p className="font-display font-bold text-lg">{t.occupancy}%</p>
                        <p className="text-[10px] sm:text-xs text-muted-foreground">Occup.</p>
                      </div>
                    </div>
                    <div className="mt-3 h-2 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${t.occupancy}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}

            <h3 className="text-sm font-medium text-muted-foreground mb-3">Liste complète</h3>
            <div className="flex flex-col sm:grid sm:grid-cols-2 gap-2">
              {terrains.map((t) => (
                <div key={t.id} className="stat-card flex items-center gap-3">
                  <img src={defaultImages[(t.id - 1) % defaultImages.length]} alt={t.nom} className="w-14 h-14 rounded-xl object-cover flex-shrink-0" loading="lazy" width={56} height={56} />
                  <div className="flex-1 min-w-0">
                    <p className="font-display font-semibold text-xs sm:text-sm truncate">{t.nom}</p>
                    <p className="text-[10px] sm:text-xs text-muted-foreground">{t.ville} · {t.type} · {t.prix_heure.toLocaleString()} CFA/h</p>
                    <span className={`inline-block mt-1 px-2 py-0.5 rounded-full text-[9px] font-medium ${t.is_active ? "bg-accent text-accent-foreground" : "bg-destructive/10 text-destructive"}`}>
                      {t.is_active ? "Disponible" : "Indisponible"}
                    </span>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                </div>
              ))}
            </div>
          </section>
        )}

        {activeTab === "Employés" && (
          <section className="responsive-padding mt-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="section-title">Mes employés (gérants)</h2>
              <Button size="sm" variant="hero" className="h-8 gap-1 text-xs sm:text-sm">
                <UserPlus className="w-3 h-3" /> Ajouter
              </Button>
            </div>
            <div className="flex flex-col sm:grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {employes.map((e) => (
                <div key={e.id} className="stat-card">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                      <Users className="w-5 h-5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-display font-semibold text-sm">{e.nom}</p>
                      <p className="text-[10px] sm:text-xs text-muted-foreground">{e.telephone}</p>
                    </div>
                    <button className="text-destructive/50 hover:text-destructive transition-colors" onClick={() => handleDeleteEmploye(e.id)}>
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="mt-3 flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Affecté à : <span className="font-medium text-foreground">{e.terrain_nom || 'Non affecté'}</span></span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${e.is_active ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground"}`}>
                      {e.is_active ? "Actif" : "Inactif"}
                    </span>
                  </div>
                </div>
              ))}
              {employes.length === 0 && (
                <p className="text-sm text-muted-foreground col-span-full text-center py-4">Aucun employé</p>
              )}
            </div>
          </section>
        )}

        {activeTab === "Réservations" && (
          <section className="responsive-padding mt-5">
            <h2 className="section-title mb-4">Historique des réservations</h2>
            <div className="flex flex-col gap-2">
              {reservations.map((r) => {
                const statusColors: Record<string, string> = {
                  en_attente: "bg-secondary/20 text-secondary-foreground",
                  acceptee: "bg-accent text-accent-foreground",
                  refusee: "bg-destructive/10 text-destructive",
                  annulee: "bg-muted text-muted-foreground",
                };
                const statusLabels: Record<string, string> = {
                  en_attente: "En attente",
                  acceptee: "Acceptée",
                  refusee: "Refusée",
                  annulee: "Annulée",
                };
                return (
                  <div key={r.id} className="stat-card flex items-center gap-3">
                    <img src={defaultImages[((r.terrain_id || 1) - 1) % defaultImages.length]} alt={r.terrain_nom} className="w-12 h-12 rounded-xl object-cover flex-shrink-0" loading="lazy" />
                    <div className="flex-1 min-w-0">
                      <p className="font-display font-semibold text-xs sm:text-sm truncate">{r.terrain_nom}</p>
                      <p className="text-[10px] sm:text-xs text-muted-foreground">{r.joueur_nom} · {r.date} · {r.heure_debut}-{r.heure_fin}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${statusColors[r.statut] || ''}`}>
                        {statusLabels[r.statut] || r.statut}
                      </span>
                      <span className="text-xs font-bold text-primary">{(r.montant || 0).toLocaleString()} CFA</span>
                    </div>
                  </div>
                );
              })}
              {reservations.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">Aucune réservation</p>
              )}
            </div>
          </section>
        )}

        {/* Actions rapides */}
        <section className="responsive-padding mt-5">
          <div className="bg-foreground rounded-2xl p-4 sm:p-6">
            <h3 className="font-display font-bold text-sm sm:text-base text-background mb-3">Actions rapides</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Button variant="outline" size="sm" className="bg-background/10 border-background/20 text-background text-xs sm:text-sm justify-start gap-2" onClick={() => setActiveTab("Employés")}>
                <Users className="w-3 h-3" /> Gérer les employés
              </Button>
              <Button variant="outline" size="sm" className="bg-background/10 border-background/20 text-background text-xs sm:text-sm justify-start gap-2" onClick={() => setActiveTab("Vue d'ensemble")}>
                <BarChart3 className="w-3 h-3" /> Voir les rapports
              </Button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

export default OwnerDashboard;
