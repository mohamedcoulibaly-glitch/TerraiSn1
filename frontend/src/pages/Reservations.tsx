import { Calendar, Clock, ArrowLeft, ExternalLink, Star, MessageSquare } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { reservationsApi, avisApi } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const statusConfig: Record<string, { label: string; className: string }> = {
  en_attente: { label: "En attente", className: "bg-secondary/20 text-secondary-foreground" },
  acceptee: { label: "Acceptée", className: "bg-accent text-accent-foreground" },
  refusee: { label: "Refusée", className: "bg-destructive/10 text-destructive" },
  annulee: { label: "Annulée", className: "bg-muted text-muted-foreground" },
};

// Star Rating Component
const StarRating = ({ value, onChange, interactive = false }: { value: number; onChange?: (value: number) => void; interactive?: boolean }) => {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          disabled={!interactive}
          onClick={() => interactive && onChange?.(star)}
          className={`${interactive ? 'cursor-pointer hover:scale-110' : 'cursor-default'} transition-transform`}
        >
          <Star
            className={`w-6 h-6 ${star <= value ? 'fill-secondary text-secondary' : 'text-muted-foreground'}`}
          />
        </button>
      ))}
    </div>
  );
};

const filterTabs = ["Toutes", "En attente", "Acceptées", "Passées"];

const Reservations = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("Toutes");
  const [reservations, setReservations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancelId, setCancelId] = useState<number | null>(null);
  const [reviewReservation, setReviewReservation] = useState<any>(null);
  const [reviewNote, setReviewNote] = useState(0);
  const [reviewComment, setReviewComment] = useState("");
  const [submittingReview, setSubmittingReview] = useState(false);

  useEffect(() => {
    loadReservations();
  }, []);

  const loadReservations = async () => {
    try {
      const data = await reservationsApi.mes();
      setReservations(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const filtered = reservations.filter((r) => {
    if (activeTab === "En attente") return r.statut === "en_attente";
    if (activeTab === "Acceptées") return r.statut === "acceptee";
    if (activeTab === "Passées") return r.statut === "refusee" || r.statut === "annulee";
    return true;
  });

  const handleCancel = async (id: number) => {
    try {
      await reservationsApi.annuler(id);
      setReservations(prev => prev.map(r => r.id === id ? { ...r, statut: "annulee" } : r));
      setCancelId(null);
      toast.success("Réservation annulée avec succès");
    } catch (err: any) {
      toast.error(err.message || "Erreur lors de l'annulation");
    }
  };

  const handleSubmitReview = async () => {
    if (reviewNote === 0) {
      toast.error("Veuillez sélectionner une note");
      return;
    }
    if (!reviewComment.trim()) {
      toast.error("Veuillez ajouter un commentaire");
      return;
    }

    setSubmittingReview(true);
    try {
      await avisApi.create({
        terrain_id: reviewReservation.terrain_id,
        reservation_id: reviewReservation.id,
        note: reviewNote,
        commentaire: reviewComment,
      });
      toast.success("Avis soumis avec succès ! Merci pour votre retour.");
      setReviewReservation(null);
      setReviewNote(0);
      setReviewComment("");
    } catch (err: any) {
      toast.error(err.message || "Erreur lors de l'envoi de l'avis");
    } finally {
      setSubmittingReview(false);
    }
  };

  const openReviewModal = (reservation: any) => {
    setReviewReservation(reservation);
    setReviewNote(0);
    setReviewComment("");
  };

  const defaultImages = ['/src/assets/field-1.jpg', '/src/assets/field-2.jpg', '/src/assets/field-3.jpg', '/src/assets/field-4.jpg'];

  return (
    <div className="page-container">
      <div className="flex items-center gap-3 responsive-padding py-4">
        <button onClick={() => navigate("/")} className="bg-muted rounded-full p-2">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="font-display font-bold text-lg sm:text-xl">Mes réservations</h1>
      </div>

      <div className="flex gap-2 responsive-padding overflow-x-auto scrollbar-hide">
        {filterTabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-full text-xs sm:text-sm font-medium transition-colors flex-shrink-0 ${
              activeTab === tab ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="responsive-padding mt-4">
        {loading ? (
          <div className="text-center py-10 text-muted-foreground text-sm animate-pulse">Chargement...</div>
        ) : (
          <div className="flex flex-col sm:grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground text-sm col-span-full">
                <p className="text-3xl mb-2">📭</p>
                Aucune réservation trouvée
              </div>
            ) : (
              filtered.map((r) => {
                const status = statusConfig[r.statut] || statusConfig.en_attente;
                const canCancel = r.statut === "en_attente" || r.statut === "acceptee";
                const terrainImage = defaultImages[((r.terrain_id || 1) - 1) % defaultImages.length];
                return (
                   <div key={r.id} className="field-card flex gap-3 p-3 relative">
                     <img
                       src={terrainImage}
                       alt={r.terrain_nom}
                       className="w-20 h-20 sm:w-24 sm:h-24 rounded-xl object-cover flex-shrink-0"
                       loading="lazy"
                       width={80}
                       height={80}
                     />
                     <div className="flex flex-col justify-between flex-1 min-w-0">
                       <div>
                         <div className="flex items-center gap-2">
                           <h3 className="font-display font-semibold text-sm truncate">{r.terrain_nom}</h3>
                           <button
                             onClick={() => navigate(`/terrain/${r.terrain_id}`)}
                             className="text-muted-foreground hover:text-primary transition-colors"
                             title="Voir le terrain"
                           >
                             <ExternalLink className="w-3 h-3" />
                           </button>
                         </div>
                         <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                           <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{r.date}</span>
                           <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{r.heure_debut}-{r.heure_fin}</span>
                         </div>
                       </div>
                        <div className="flex items-center justify-between mt-1">
                          <div className="flex items-center gap-2">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${status.className}`}>
                              {status.label}
                            </span>
                            {canCancel && (
                              <button
                                onClick={() => setCancelId(r.id)}
                                className="text-destructive text-[10px] font-medium hover:underline"
                              >
                                Annuler
                              </button>
                            )}
                            {/* Show "Avis" button for accepted reservations OR past reservations (date is in the past) */}
                            {(() => {
                              const reservationDate = new Date(r.date);
                              const today = new Date();
                              today.setHours(0, 0, 0, 0);
                              const isPastReservation = reservationDate < today;
                              const canReview = r.statut === "acceptee" || (isPastReservation && (r.statut === "acceptee" || r.statut === "refusee" || r.statut === "annulee"));
                              return canReview ? (
                                <button
                                  onClick={() => openReviewModal(r)}
                                  className="text-primary text-[10px] font-medium hover:underline flex items-center gap-1"
                                >
                                  <MessageSquare className="w-3 h-3" />
                                  Avis
                                </button>
                              ) : null;
                            })()}
                          </div>
                          <span className="price-tag text-sm">{(r.montant || 0).toLocaleString()} CFA</span>
                        </div>
                     </div>
                   </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* Cancel confirmation dialog */}
      <Dialog open={!!cancelId} onOpenChange={() => setCancelId(null)}>
        <DialogContent className="max-w-sm mx-4">
          <DialogHeader>
            <DialogTitle>Annuler la réservation</DialogTitle>
            <DialogDescription>
              Êtes-vous sûr de vouloir annuler cette réservation ? Cette action est irréversible.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={() => setCancelId(null)}>Non, garder</Button>
            <Button variant="destructive" onClick={() => cancelId && handleCancel(cancelId)}>Oui, annuler</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Review Modal */}
      <Dialog open={!!reviewReservation} onOpenChange={() => setReviewReservation(null)}>
        <DialogContent className="max-w-md mx-4">
          <DialogHeader>
            <DialogTitle>Donner votre avis</DialogTitle>
            <DialogDescription>
              Partagez votre expérience pour le terrain {reviewReservation?.terrain_nom}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Note</Label>
              <StarRating value={reviewNote} onChange={setReviewNote} interactive />
            </div>
            <div className="space-y-2">
              <Label htmlFor="review-comment">Commentaire</Label>
              <Textarea
                id="review-comment"
                placeholder="Décrivez votre expérience (facultatif)"
                value={reviewComment}
                onChange={(e) => setReviewComment(e.target.value)}
                rows={4}
                className="resize-none"
              />
            </div>
          </div>
          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={() => setReviewReservation(null)}>Annuler</Button>
            <Button
              variant="hero"
              onClick={handleSubmitReview}
              disabled={submittingReview || reviewNote === 0}
            >
              {submittingReview ? "Envoi..." : "Envoyer l'avis"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Reservations;
