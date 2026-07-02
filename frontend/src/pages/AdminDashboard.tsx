import { ArrowLeft, Users, Building2, TrendingUp, DollarSign, Calendar, Search, Eye, AlertCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { adminApi, proprietaireApi } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const tabs = ["Vue d'ensemble", "Propriétaires", "Audit"];

const AdminDashboard = () => {
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("Vue d'ensemble");
  const [stats, setStats] = useState<any>(null);
  const [proprietaires, setProprietaires] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedProprio, setSelectedProprio] = useState<any>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editForm, setEditForm] = useState({ nom: "", email: "", telephone: "" });
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    if (!isAuthenticated || user?.role !== 'superadmin') {
      navigate('/connexion');
      return;
    }
    loadData();
  }, [isAuthenticated]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [statsData, terrainsData] = await Promise.all([
        adminApi.stats(),
        proprietaireApi.terrains(),
      ]);
      setStats(statsData);
      // Extract unique proprietors from terrains or use stats
      if (statsData?.proprietaires) {
        setProprietaires(statsData.proprietaires);
      }
      // Mock audit logs for now
      setAuditLogs([
        { id: 1, action: "Création compte", user: "Mamadou Diallo", target: "Nouveau propriétaire", date: "2024-01-15 10:30" },
        { id: 2, action: "Modification terrain", user: "Fatou Sarr", target: "Terrain Les Palmiers", date: "2024-01-15 09:15" },
        { id: 3, action: "Suppression réservation", user: "Ibrahim Ba", target: "Réservation #1234", date: "2024-01-14 16:45" },
        { id: 4, action: "Connexion admin", user: "Admin", target: "Tableau de bord", date: "2024-01-14 08:00" },
      ]);
    } catch (err: any) {
      toast.error(err.message || "Erreur lors du chargement");
    } finally {
      setLoading(false);
    }
  };

  const handleEditProprio = (proprio: any) => {
    setSelectedProprio(proprio);
    setEditForm({
      nom: proprio.nom || "",
      email: proprio.email || "",
      telephone: proprio.telephone || "",
    });
    setShowEditModal(true);
  };

  const handleUpdateProprio = async () => {
    if (!selectedProprio) return;
    setUpdating(true);
    try {
      await adminApi.updateProprietaire(selectedProprio.id, editForm);
      toast.success("Propriétaire mis à jour");
      setShowEditModal(false);
      loadData();
    } catch (err: any) {
      toast.error(err.message || "Erreur lors de la mise à jour");
    } finally {
      setUpdating(false);
    }
  };

  const filteredProprietaires = proprietaires.filter((p: any) =>
    p.nom?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.email?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Chargement...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="bg-foreground responsive-padding pt-5 pb-8 rounded-b-3xl">
          <div className="flex items-center gap-3 mb-4">
            <button onClick={() => navigate("/")} className="bg-background/20 rounded-full p-2">
              <ArrowLeft className="w-5 h-5 text-background" />
            </button>
            <span className="font-display font-bold text-background text-sm">⚽ TerrainSN Admin</span>
          </div>
          <h1 className="font-display font-bold text-xl sm:text-2xl text-background">Administration</h1>
          <p className="text-background/60 text-sm mt-1">Tableau de bord superadmin</p>
        </div>

        {/* Tabs */}
        <div className="responsive-padding -mt-4 relative z-10">
          <div className="flex gap-2 overflow-x-auto scrollbar-hide bg-card rounded-2xl p-1 shadow-sm border border-border/30">
            {tabs.map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-medium transition-colors flex-shrink-0 ${
                  activeTab === tab ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>

        {/* Overview Tab */}
        {activeTab === "Vue d'ensemble" && (
          <div className="responsive-padding mt-4">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
              <div className="stat-card">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center">
                    <Building2 className="w-4 h-4 text-primary" />
                  </div>
                </div>
                <p className="font-display font-bold text-lg">{stats?.totalTerrains || 0}</p>
                <p className="text-[10px] text-muted-foreground">Terrains</p>
              </div>
              <div className="stat-card">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-xl bg-accent flex items-center justify-center">
                    <Users className="w-4 h-4 text-accent-foreground" />
                  </div>
                </div>
                <p className="font-display font-bold text-lg">{stats?.totalUsers || 0}</p>
                <p className="text-[10px] text-muted-foreground">Utilisateurs</p>
              </div>
              <div className="stat-card">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-xl bg-secondary/20 flex items-center justify-center">
                    <DollarSign className="w-4 h-4 text-secondary" />
                  </div>
                </div>
                <p className="font-display font-bold text-lg">{stats?.totalRevenue?.toLocaleString() || 0}</p>
                <p className="text-[10px] text-muted-foreground">Revenus (CFA)</p>
              </div>
              <div className="stat-card">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-xl bg-muted flex items-center justify-center">
                    <Calendar className="w-4 h-4 text-muted-foreground" />
                  </div>
                </div>
                <p className="font-display font-bold text-lg">{stats?.totalReservations || 0}</p>
                <p className="text-[10px] text-muted-foreground">Réservations</p>
              </div>
            </div>

            <div className="glass-card p-4">
              <h3 className="font-display font-semibold text-sm mb-3">Statistiques rapides</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-[10px] text-muted-foreground">Propriétaires actifs</p>
                  <p className="text-lg font-bold">{stats?.activeProprietaires || 0}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">Gérants</p>
                  <p className="text-lg font-bold">{stats?.totalGerants || 0}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">Taux d'occupation moyen</p>
                  <p className="text-lg font-bold">{stats?.avgOccupancyRate || 0}%</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">Réservations en attente</p>
                  <p className="text-lg font-bold text-secondary">{stats?.pendingReservations || 0}</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Propriétaires Tab */}
        {activeTab === "Propriétaires" && (
          <div className="responsive-padding mt-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Rechercher un propriétaire..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>

            <div className="glass-card overflow-hidden">
              {filteredProprietaires.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-xs font-medium text-muted-foreground p-3 text-left">Nom</th>
                        <th className="text-xs font-medium text-muted-foreground p-3 text-left">Email</th>
                        <th className="text-xs font-medium text-muted-foreground p-3 text-left">Téléphone</th>
                        <th className="text-xs font-medium text-muted-foreground p-3 text-left">Terrains</th>
                        <th className="text-xs font-medium text-muted-foreground p-3 text-left">Statut</th>
                        <th className="text-xs font-medium text-muted-foreground p-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {filteredProprietaires.map((p: any) => (
                        <tr key={p.id} className="hover:bg-muted/30 transition-colors">
                          <td className="p-3">
                            <span className="text-sm font-medium">{p.nom}</span>
                          </td>
                          <td className="p-3">
                            <span className="text-sm text-muted-foreground">{p.email}</span>
                          </td>
                          <td className="p-3">
                            <span className="text-sm text-muted-foreground">{p.telephone}</span>
                          </td>
                          <td className="p-3">
                            <span className="text-sm">{p.terrainCount || 0}</span>
                          </td>
                          <td className="p-3">
                            <Badge className={p.is_active ? "bg-accent" : "bg-muted"}>
                              {p.is_active ? "Actif" : "Inactif"}
                            </Badge>
                          </td>
                          <td className="p-3 text-right">
                            <button
                              onClick={() => handleEditProprio(p)}
                              className="text-primary hover:underline text-sm flex items-center justify-end gap-1 ml-auto"
                            >
                              <Eye className="w-3 h-3" /> Voir
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="p-8 text-center text-muted-foreground text-sm">
                  Aucun propriétaire trouvé
                </div>
              )}
            </div>
          </div>
        )}

        {/* Audit Tab */}
        {activeTab === "Audit" && (
          <div className="responsive-padding mt-4">
            <h2 className="section-title mb-4 flex items-center gap-2">
              <AlertCircle className="w-4 h-4" />
              Journal d'activité
            </h2>
            <div className="glass-card">
              {auditLogs.map((log) => (
                <div key={log.id} className="flex items-start gap-3 p-4 border-b border-border last:border-b-0">
                  <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                    <AlertCircle className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{log.action}</p>
                    <p className="text-[10px] text-muted-foreground">
                      Par <span className="font-medium">{log.user}</span> sur <span className="font-medium">{log.target}</span>
                    </p>
                  </div>
                  <span className="text-[10px] text-muted-foreground whitespace-nowrap">{log.date}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Edit Proprietor Modal */}
      <Dialog open={showEditModal} onOpenChange={setShowEditModal}>
        <DialogContent className="max-w-md mx-4">
          <DialogHeader>
            <DialogTitle>Modifier le propriétaire</DialogTitle>
            <DialogDescription>
              Modifier les informations de {selectedProprio?.nom}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Nom</label>
              <Input
                value={editForm.nom}
                onChange={(e) => setEditForm(prev => ({ ...prev, nom: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Email</label>
              <Input
                type="email"
                value={editForm.email}
                onChange={(e) => setEditForm(prev => ({ ...prev, email: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Téléphone</label>
              <Input
                value={editForm.telephone}
                onChange={(e) => setEditForm(prev => ({ ...prev, telephone: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={() => setShowEditModal(false)}>Annuler</Button>
            <Button variant="hero" onClick={handleUpdateProprio} disabled={updating}>
              {updating ? "Mise à jour..." : "Mettre à jour"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminDashboard;