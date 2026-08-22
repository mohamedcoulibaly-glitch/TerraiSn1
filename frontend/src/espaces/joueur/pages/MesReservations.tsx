import { Calendar, Clock, ArrowLeft, ExternalLink, Star, MessageSquare } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { reservationsApi, avisApi } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import SkeletonMesReservations from "@/components/skeletons/SkeletonMesReservations";
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
  const [cancelPolitique, setCancelPolitique] = useState<{
    titre?: string;
    message?: string;
    type_annulation?: string;
    eligible?: boolean;
    delai_heures?: number;
  } | null>(null);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [cancelling, setCancelling] = useState(false);
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

  const openCancel = async (reservation: any) => {
    setCancelId(reservation.id);
    setCancelPolitique(reservation.politique_remboursement || null);
    setCancelLoading(true);
    try {
      const data = (await reservationsApi.politiqueAnnulation(reservation.id)) as {
        politique_remboursement?: typeof cancelPolitique;
      };
      if (data?.politique_remboursement) setCancelPolitique(data.politique_remboursement);
    } catch {
      /* garde la politique déjà connue sur la carte */
    } finally {
      setCancelLoading(false);
    }
  };

  const closeCancel = () => {
    setCancelId(null);
    setCancelPolitique(null);
  };

  const handleCancel = async (id: number) => {
    setCancelling(true);
    try {
      const result = (await reservationsApi.annuler(id)) as {
        rembourse?: boolean;
        politique?: { titre?: string; type_annulation?: string };
      };
      setReservations((prev) => prev.map((r) => (r.id === id ? { ...r, statut: "annule" } : r)));
      closeCancel();
      toast.success(
        result?.rembourse || result?.politique?.type_annulation === "avec_remboursement"
          ? "Réservation annulée — remboursement en cours (WhatsApp envoyé)"
          : "Réservation annulée sans remboursement — créneau libéré (WhatsApp envoyé)",
      );
    } catch (err: any) {
      toast.error(err.message || "Erreur lors de l'annulation");
    } finally {
      setCancelling(false);
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
          className="w-10 h-10 rounded-full bg-[var(--surface)] border border-[var(--color-border)] flex items-center justify-center"
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
                : "bg-[var(--surface)] text-[var(--color-text-secondary)] border border-[var(--color-border)]"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="responsive-padding mt-4">
        {loading ? (
          <SkeletonMesReservations />
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
              <div className="text-center py-14 col-span-full space-y-4">
                <svg width="72" height="72" viewBox="0 0 80 80" className="mx-auto text-[var(--color-primary)] opacity-80" aria-hidden>
                  <circle cx="40" cy="40" r="28" stroke="currentColor" strokeWidth="2.5" fill="none" />
                  <path d="M40 12 L52 28 L48 48 H32 L28 28 Z" stroke="currentColor" strokeWidth="2" fill="var(--color-primary-glow)" />
                </svg>
                <h3 className="text-base font-semibold" style={{ fontFamily: "var(--font-display)" }}>
                  {reservations.length === 0
                    ? "Aucune réservation pour le moment"
                    : "Aucune réservation dans cet onglet"}
                </h3>
                <p className="text-sm text-[var(--color-text-muted)]">Prêt pour un match entre potes ?</p>
                {reservations.length === 0 && (
                  <button
                    type="button"
                    onClick={() => navigate("/")}
                    className="mx-auto block max-w-[280px] w-full h-12 rounded-[var(--radius-md)] bg-[var(--color-primary)] text-white text-sm font-medium"
                  >
                    Trouver un terrain
                  </button>
                )}
              </div>
            ) : (
              filtered.map((r) => {
                const status = statusConfig[r.statut] || statusConfig.en_attente;
                const canCancel = r.statut === "en_attente";
                return (
                  <div
                    key={r.id}
                    className={`relative bg-[var(--surface)] rounded-[var(--radius-lg)] border border-[var(--color-border)] border-l-4 ${status.border} shadow-[var(--shadow-sm)] overflow-hidden`}
                  >
                    <div className="p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <h3 className="font-semibold text-sm truncate" style={{ fontFamily: "var(--font-display)" }}>
                            {r.terrain_nom}
                          </h3>
                          <p className="text-[12px] text-[var(--color-text-muted)] mt-0.5 truncate">
                            {r.terrain_ville || r.adresse || ""}
                          </p>
                        </div>
                        <span className={`px-2.5 py-1 rounded-full text-[11px] font-medium flex-shrink-0 ${status.badge}`}>
                          {status.label}
                        </span>
                      </div>
                    </div>

                    <div className="relative mx-4 border-t border-dashed border-[var(--color-border)]">
                      <span className="absolute -left-6 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-[var(--color-bg)]" />
                      <span className="absolute -right-6 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-[var(--color-bg)]" />
                    </div>

                    <div className="p-4 space-y-3">
                      <p className="text-[15px] font-semibold text-[var(--color-primary)]" style={{ fontFamily: "var(--font-display)" }}>
                        {r.date} · {r.heure_debut}–{r.heure_fin}
                      </p>
                      {r.code_reservation && (
                        <p className="text-[12px] text-[var(--color-text-muted)]">Code {r.code_reservation}</p>
                      )}
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-3">
                          {r.statut === "confirme" && r.qr_code_url && (
                            <a
                              href={r.qr_code_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[12px] font-medium text-[var(--color-primary)] border border-[var(--color-primary)] rounded-[var(--radius-md)] px-3 min-h-10 inline-flex items-center"
                            >
                              Voir le QR code
                            </a>
                          )}
                          {canCancel && (
                            <button
                              type="button"
                              onClick={() => void openCancel(r)}
                              className="text-[var(--color-danger)] text-[12px] font-medium min-h-10"
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
                                className="text-[var(--color-primary)] text-[12px] font-medium flex items-center gap-1 min-h-10"
                              >
                                <MessageSquare className="w-3 h-3" />
                                Avis
                              </button>
                            ) : null;
                          })()}
                        </div>
                        <div className="text-right">
                          <span className="text-sm font-semibold text-[var(--color-primary)]">
                            {(r.prix_total || r.montant || 0).toLocaleString()} FCFA
                          </span>
                          {(r.montant_avance != null || r.acompte != null) && (
                            <p className="text-[11px] text-[var(--color-text-muted)]">
                              Avance {(Number(r.montant_avance ?? r.acompte) || 0).toLocaleString()} FCFA
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      <Dialog open={!!cancelId} onOpenChange={(open) => !open && closeCancel()}>
        <DialogContent className="max-w-sm mx-4">
          <DialogHeader>
            <DialogTitle>
              {cancelPolitique?.titre || "Annuler la réservation"}
            </DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-3 text-sm text-[var(--color-text-secondary)]">
                {cancelLoading ? (
                  <p>Vérification de la politique du terrain…</p>
                ) : (
                  <>
                    <p className="font-medium text-[var(--color-text-primary)]">
                      {cancelPolitique?.type_annulation === "avec_remboursement"
                        ? "Avec remboursement"
                        : "Sans remboursement"}
                      {cancelPolitique?.delai_heures != null && cancelPolitique.delai_heures > 0
                        ? ` · délai terrain ${cancelPolitique.delai_heures} h`
                        : ""}
                    </p>
                    <p>
                      {cancelPolitique?.message ||
                        "Cette action est irréversible. Le créneau sera libéré et une notification WhatsApp sera envoyée."}
                    </p>
                  </>
                )}
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={closeCancel} disabled={cancelling}>
              Non, garder
            </Button>
            <Button
              variant="destructive"
              disabled={!cancelId || cancelling || cancelLoading}
              onClick={() => cancelId && void handleCancel(cancelId)}
            >
              {cancelling ? "Annulation…" : "Oui, annuler"}
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
