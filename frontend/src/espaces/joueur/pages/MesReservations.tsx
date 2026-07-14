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

const statusConfig: Record<string, { label: string; border: string; badge: string }> = {
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
  joue: {
    label: "Jouée",
    border: "border-l-[var(--color-primary)]",
    badge: "bg-[var(--color-primary)] text-white",
  },
  acceptee: {
    label: "Acceptée",
    border: "border-l-[var(--color-success)]",
    badge: "bg-[color-mix(in_srgb,var(--color-success)_14%,white)] text-[var(--color-success)]",
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

const StarRating = ({
  value,
  onChange,
  interactive = false,
}: {
  value: number;
  onChange?: (value: number) => void;
  interactive?: boolean;
}) => {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          disabled={!interactive}
          onClick={() => interactive && onChange?.(star)}
          className={`${interactive ? "cursor-pointer hover:scale-110" : "cursor-default"} transition-transform`}
        >
          <Star
            className={`w-6 h-6 ${
              star <= value
                ? "fill-[var(--color-accent)] text-[var(--color-accent)]"
                : "text-[var(--color-text-muted)]"
            }`}
          />
        </button>
      ))}
    </div>
  );
};

/** Filtres UI — libellés brief ; « À venir » / « Passées » basés sur la date. */
const filterTabs = [
  { id: "Toutes", label: "Toutes" },
  { id: "Acceptées", label: "À venir" },
  { id: "Passées", label: "Passées" },
] as const;

function reservationDay(dateStr: string): Date {
  const d = new Date(`${String(dateStr).slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? new Date(0) : d;
}

function startOfToday(): Date {
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return t;
}

const Reservations = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<(typeof filterTabs)[number]["id"]>("Toutes");
  const [reservations, setReservations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cancelId, setCancelId] = useState<number | null>(null);
  const [reviewReservation, setReviewReservation] = useState<any>(null);
  const [reviewNote, setReviewNote] = useState(0);
  const [reviewComment, setReviewComment] = useState("");
  const [submittingReview, setSubmittingReview] = useState(false);

  useEffect(() => {
    loadReservations();
  }, []);

  const loadReservations = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await reservationsApi.mes();
      setReservations(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setReservations([]);
      setLoadError(err?.message || "Impossible de charger vos réservations.");
      toast.error(err?.message || "Impossible de charger vos réservations.");
    } finally {
      setLoading(false);
    }
  };

  const today = startOfToday();
  const filtered = reservations.filter((r) => {
    const day = reservationDay(r.date);
    const isPastDay = day < today;
    const isClosed = ["joue", "annule", "annulee", "refusee"].includes(r.statut);
    if (activeTab === "Acceptées") {
      // À venir : date >= aujourd'hui et pas clôturée
      return !isPastDay && !isClosed;
    }
    if (activeTab === "Passées") {
      // Historique : date passée ou statut terminal
      return isPastDay || isClosed;
    }
    return true;
  });

  const handleCancel = async (id: number) => {
    try {
      await reservationsApi.annuler(id);
      setReservations((prev) => prev.map((r) => (r.id === id ? { ...r, statut: "annule" } : r)));
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

  return (
    <div className="page-container">
      <div className="flex items-center gap-3 responsive-padding py-4">
        <button
          type="button"
          onClick={() => navigate("/")}
          className="w-10 h-10 rounded-full bg-white border border-[var(--color-border)] flex items-center justify-center"
          aria-label="Retour"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1
          className="text-lg sm:text-xl font-semibold text-[var(--color-text-primary)]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Mes réservations
        </h1>
      </div>

      <div className="flex gap-2 responsive-padding overflow-x-auto scrollbar-hide">
        {filterTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 min-h-[40px] rounded-full text-sm font-medium transition-colors flex-shrink-0 ${
              activeTab === tab.id
                ? "bg-[var(--color-primary)] text-white"
                : "bg-white text-[var(--color-text-secondary)] border border-[var(--color-border)]"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="responsive-padding mt-4">
        {loading ? (
          <div className="text-center py-10 text-[var(--color-text-secondary)] text-sm animate-pulse">
            Chargement...
          </div>
        ) : loadError ? (
          <div className="text-center py-14 col-span-full space-y-3">
            <p className="text-[var(--color-text-secondary)] text-sm">{loadError}</p>
            <Button type="button" variant="outline" onClick={loadReservations}>
              Réessayer
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3 max-w-xl mx-auto sm:max-w-none sm:grid sm:grid-cols-2 lg:grid-cols-3">
            {filtered.length === 0 ? (
              <div className="text-center py-14 text-[var(--color-text-secondary)] text-sm col-span-full">
                {reservations.length === 0
                  ? "Vous n'avez encore aucune réservation."
                  : "Aucune réservation dans cet onglet."}
              </div>
            ) : (
              filtered.map((r) => {
                const status = statusConfig[r.statut] || statusConfig.en_attente;
                const canCancel = r.statut === "en_attente";
                return (
                  <div
                    key={r.id}
                    className={`bg-white rounded-[var(--radius-md)] border border-[var(--color-border)] border-l-4 ${status.border} p-4 shadow-sm`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h3
                            className="font-semibold text-sm truncate"
                            style={{ fontFamily: "var(--font-display)" }}
                          >
                            {r.terrain_nom}
                          </h3>
                          <button
                            type="button"
                            onClick={() => navigate(`/terrain/${r.terrain_id}`)}
                            className="text-[var(--color-text-muted)] hover:text-[var(--color-primary)]"
                            title="Voir le terrain"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--color-text-muted)] mt-1.5">
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            {r.date}
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {r.heure_debut}–{r.heure_fin}
                          </span>
                        </div>
                      </div>
                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-medium flex-shrink-0 ${status.badge}`}>
                        {status.label}
                      </span>
                    </div>

                    <div className="flex items-center justify-between mt-4 gap-2">
                      <div className="flex items-center gap-3">
                        {canCancel && (
                          <button
                            type="button"
                            onClick={() => setCancelId(r.id)}
                            className="text-[var(--color-danger)] text-xs font-medium min-h-[40px]"
                          >
                            Annuler
                          </button>
                        )}
                        {(() => {
                          const isPastReservation = reservationDay(r.date) < startOfToday();
                          const canReview =
                            r.statut === "joue" ||
                            (isPastReservation &&
                              (r.statut === "acceptee" ||
                                r.statut === "confirme" ||
                                r.statut === "refusee" ||
                                r.statut === "annulee" ||
                                r.statut === "annule"));
                          return canReview ? (
                            <button
                              type="button"
                              onClick={() => openReviewModal(r)}
                              className="text-[var(--color-primary)] text-xs font-medium flex items-center gap-1 min-h-[40px]"
                            >
                              <MessageSquare className="w-3 h-3" />
                              Avis
                            </button>
                          ) : null;
                        })()}
                      </div>
                      <div className="text-right">
                        <span className="text-sm font-semibold text-[var(--color-primary)]">
                          {(r.prix_total || r.montant || 0).toLocaleString()} CFA
                        </span>
                        {r.statut === "confirme" && (
                          <p className="text-[10px] text-[var(--color-text-muted)]">
                            Reste {(r.reste_a_payer || 0).toLocaleString()} CFA
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      <Dialog open={!!cancelId} onOpenChange={() => setCancelId(null)}>
        <DialogContent className="max-w-sm mx-4">
          <DialogHeader>
            <DialogTitle>Annuler la réservation</DialogTitle>
            <DialogDescription>
              Êtes-vous sûr de vouloir annuler cette réservation ? Cette action est irréversible.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={() => setCancelId(null)}>
              Non, garder
            </Button>
            <Button variant="destructive" onClick={() => cancelId && handleCancel(cancelId)}>
              Oui, annuler
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
            <Button variant="outline" onClick={() => setReviewReservation(null)}>
              Annuler
            </Button>
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
