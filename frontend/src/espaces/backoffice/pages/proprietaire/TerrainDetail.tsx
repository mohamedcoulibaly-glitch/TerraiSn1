import { ArrowLeft, Edit, Trash2, Clock, DollarSign, Calendar, Users, MapPin, CheckCircle, XCircle, Plus } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { terrainsApi, reservationsApi, employesApi } from "@/lib/api";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import TerrainFormModal from "@/espaces/backoffice/components/TerrainFormModal";
import EmployeeFormModal from "@/espaces/backoffice/components/EmployeeFormModal";
import { fieldImageForId } from "@/espaces/joueur/components/FieldPhoto";

const tabs = ["Vue d'ensemble", "Réservations", "Gérant"];

const OwnerTerrainDetail = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [loading, setLoading] = useState(true);
  const [terrain, setTerrain] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [reservations, setReservations] = useState<any[]>([]);
  const [employes, setEmployes] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState("Vue d'ensemble");
  const [showEditModal, setShowEditModal] = useState(false);
  const [showEmployeeModal, setShowEmployeeModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    loadData();
  }, [id]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [terrainData, reservationsData, employesData] = await Promise.all([
        terrainsApi.get(id!),
        reservationsApi.parTerrain(id!),
        employesApi.list(),
      ]);
      setTerrain(terrainData);
      setReservations(reservationsData);
      const terrainEmployes = employesData.filter((e: any) => e.terrain_id == id);
      setEmployes(terrainEmployes);
      
      const totalRevenue = reservationsData.reduce((sum: number, r: any) => sum + (r.montant || 0), 0);
      const totalReservations = reservationsData.length;
      const acceptedReservations = reservationsData.filter((r: any) => ['acceptee', 'confirme', 'joue'].includes(r.statut)).length;
      const occupancyRate = totalReservations > 0 ? Math.round((acceptedReservations / totalReservations) * 100) : 0;
      
      setStats({ totalRevenue, totalReservations, occupancyRate });
    } catch (err: any) {
      toast.error(err.message || "Erreur lors du chargement");
      navigate("/backoffice/proprietaire");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await terrainsApi.remove(id!);
      toast.success("Terrain supprimé avec succès");
      navigate("/backoffice/proprietaire");
    } catch (err: any) {
      toast.error(err.message || "Erreur lors de la suppression");
    } finally {
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const handleToggleActive = async () => {
    try {
      await terrainsApi.update(id!, { is_active: !terrain.is_active });
      setTerrain(prev => ({ ...prev, is_active: !prev.is_active }));
      toast.success(`Terrain ${terrain.is_active ? 'désactivé' : 'activé'}`);
    } catch (err: any) {
      toast.error(err.message || "Erreur lors de la mise à jour");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Chargement...</div>
      </div>
    );
  }

  if (!terrain) {
    return (
      <div className="page-container flex items-center justify-center">
        <div className="text-center">
          <p className="text-muted-foreground mb-4">Terrain non trouvé</p>
          <Button onClick={() => navigate("/backoffice/proprietaire")}>Retour aux terrains</Button>
        </div>
      </div>
    );
  }

  const terrainImage = terrain.photos?.[0] || fieldImageForId(terrain.id);

  return (
    <div className="min-h-screen bg-background pb-8">
      <div className="max-w-4xl mx-auto">
        <div className="bg-primary responsive-padding pt-5 pb-8 rounded-b-3xl">
          <div className="flex items-center justify-between mb-4">
            <button onClick={() => navigate("/backoffice/proprietaire")} className="bg-primary-foreground/20 rounded-full p-2">
              <ArrowLeft className="w-5 h-5 text-primary-foreground" />
            </button>
            <span className="font-display font-bold text-primary-foreground text-sm">⚽ TerrainSN</span>
            <button onClick={() => setShowEditModal(true)} className="bg-primary-foreground/20 rounded-full p-2">
              <Edit className="w-5 h-5 text-primary-foreground" />
            </button>
          </div>
          <h1 className="font-display font-bold text-xl sm:text-2xl text-primary-foreground">{terrain.nom}</h1>
          <div className="flex items-center gap-2 text-primary-foreground/70 text-sm mt-1">
            <MapPin className="w-4 h-4" />
            <span>{terrain.ville}</span>
          </div>
        </div>

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
          <div className="responsive-padding mt-4">
            <div className="rounded-2xl overflow-hidden mb-4">
              <img src={terrainImage} alt={terrain.nom} className="w-full h-48 object-cover" />
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
              <div className="stat-card">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center">
                    <DollarSign className="w-4 h-4 text-primary" />
                  </div>
                </div>
                <p className="font-display font-bold text-lg">{(stats.totalRevenue || 0).toLocaleString()}</p>
                <p className="text-[10px] text-muted-foreground">Revenus (CFA)</p>
              </div>
              <div className="stat-card">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-xl bg-accent flex items-center justify-center">
                    <Calendar className="w-4 h-4 text-accent-foreground" />
                  </div>
                </div>
                <p className="font-display font-bold text-lg">{stats.totalReservations || 0}</p>
                <p className="text-[10px] text-muted-foreground">Réservations</p>
              </div>
              <div className="stat-card">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-xl bg-secondary/20 flex items-center justify-center">
                    <Users className="w-4 h-4 text-secondary" />
                  </div>
                </div>
                <p className="font-display font-bold text-lg">{stats.occupancyRate || 0}%</p>
                <p className="text-[10px] text-muted-foreground">Taux d'occup.</p>
              </div>
              <div className="stat-card">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-xl bg-muted flex items-center justify-center">
                    <Clock className="w-4 h-4 text-muted-foreground" />
                  </div>
                </div>
                <p className="font-display font-bold text-lg">{terrain.prix_heure.toLocaleString()}</p>
                <p className="text-[10px] text-muted-foreground">Prix/heure</p>
              </div>
            </div>
            <div className="glass-card p-4">
              <h3 className="font-display font-semibold text-sm mb-3">Informations</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[10px] text-muted-foreground">Type</p>
                  <p className="text-sm font-medium">{terrain.type}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">Ville</p>
                  <p className="text-sm font-medium">{terrain.ville}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">Statut</p>
                  <Badge className={terrain.is_active ? "bg-accent" : "bg-muted"}>
                    {terrain.is_active ? "Disponible" : "Indisponible"}
                  </Badge>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 mt-4">
              <Button variant={terrain.is_active ? "outline" : "hero"} className="w-full" onClick={handleToggleActive}>
                {terrain.is_active ? <><XCircle className="w-4 h-4 mr-2" /> Désactiver</> : <><CheckCircle className="w-4 h-4 mr-2" /> Activer</>}
              </Button>
              <Button variant="outline" className="w-full text-destructive border-destructive/20" onClick={() => setShowDeleteConfirm(true)}>
                <Trash2 className="w-4 h-4 mr-2" /> Supprimer
              </Button>
            </div>
          </div>
        )}

        {activeTab === "Réservations" && (
          <div className="responsive-padding mt-4">
            <h2 className="section-title mb-4">Historique des réservations</h2>
            {reservations.length === 0 ? (
              <div className="glass-card p-8 text-center">
                <Calendar className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">Aucune réservation</p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {reservations.map((r) => (
                  <div key={r.id} className="stat-card flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                      <Users className="w-5 h-5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-display font-semibold text-xs sm:text-sm">{r.joueur_nom}</p>
                      <p className="text-[10px] text-muted-foreground">{r.date} · {r.heure_debut}-{r.heure_fin}</p>
                    </div>
                    <div className="text-right">
                      <span className="text-xs font-bold text-primary">{(r.montant || 0).toLocaleString()} CFA</span>
                      <Badge className={`text-[10px] mt-1 ${
                        ['acceptee', 'confirme'].includes(r.statut) ? 'bg-accent' : r.statut === 'joue' ? 'bg-primary text-primary-foreground' : r.statut === 'en_attente' ? 'bg-secondary/20' : 'bg-destructive/10'
                      }`}>
                        {r.statut === 'joue' ? 'Jouée' : ['acceptee', 'confirme'].includes(r.statut) ? 'Confirmée' : r.statut === 'en_attente' ? 'Avance en attente' : 'Annulée'}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === "Gérant" && (
          <div className="responsive-padding mt-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="section-title">Gérant assigné</h2>
              <Button size="sm" variant="hero" onClick={() => setShowEmployeeModal(true)}>
                <Plus className="w-3 h-3 mr-1" /> Ajouter
              </Button>
            </div>
            {employes.length === 0 ? (
              <div className="glass-card p-8 text-center">
                <Users className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">Aucun gérant assigné</p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {employes.map((e) => (
                  <div key={e.id} className="stat-card flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                      <Users className="w-5 h-5 text-primary" />
                    </div>
                    <div className="flex-1">
                      <p className="font-display font-semibold text-sm">{e.nom}</p>
                      <p className="text-[10px] text-muted-foreground">{e.telephone}</p>
                    </div>
                    <Badge className={e.is_active ? "bg-accent" : "bg-muted"}>
                      {e.is_active ? "Actif" : "Inactif"}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <TerrainFormModal open={showEditModal} onOpenChange={setShowEditModal} terrain={terrain} onSuccess={loadData} />
      <EmployeeFormModal open={showEmployeeModal} onOpenChange={setShowEmployeeModal} terrains={terrain ? [terrain] : []} onSuccess={loadData} />

      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent className="max-w-sm mx-4">
          <DialogHeader>
            <DialogTitle>Supprimer le terrain</DialogTitle>
            <DialogDescription>
              Êtes-vous sûr de vouloir supprimer ce terrain ? Cette action est irréversible.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={() => setShowDeleteConfirm(false)}>Annuler</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? "Suppression..." : "Supprimer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default OwnerTerrainDetail;
