import { useEffect, useState } from "react";
import { MessageCircle } from "lucide-react";
import { gerantApi, reservationsApi } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { localYmd } from "@/lib/localDate";
import Select2 from "@/components/Select2";
import { useWhatsappInfra } from "@/hooks/useWhatsappInfra";
import { confirmWhatsappAction, WHATSAPP_INFRA_MESSAGE } from "@/lib/whatsappMessages";
import { formatPhoneDisplay, phoneError, toLocal9 } from "@/auth/phone";
import EnAttentePaiementActions from "@/espaces/backoffice/components/EnAttentePaiementActions";
import ReservationDatesBlock from "@/components/ReservationDatesBlock";
import PaymentLockGauge from "@/components/PaymentLockGauge";
import SilentSyncDot from "@/components/SilentSyncDot";
import { useGerantDashboard, useGerantLiveInvalidate } from "@/hooks/useGerantLiveData";

const statusMeta: Record<string, { label: string; border: string; badge: string }> = {
  en_attente: {
    label: "En attente de paiement",
    border: "border-l-[var(--g-en-attente)]",
    badge: "bg-[var(--g-en-attente-bg)] text-[var(--g-en-attente)]",
  },
  confirme: {
    label: "Réservé ✓",
    border: "border-l-[var(--color-success)]",
    badge: "bg-[color-mix(in_srgb,var(--color-success)_14%,white)] text-[var(--color-success)]",
  },
  acceptee: {
    label: "Réservé ✓",
    border: "border-l-[var(--color-success)]",
    badge: "bg-[color-mix(in_srgb,var(--color-success)_14%,white)] text-[var(--color-success)]",
  },
  joue: {
    label: "Terminé ✓",
    border: "border-l-[var(--color-primary)]",
    badge: "bg-[var(--color-primary)] text-white",
  },
  match_joue: {
    label: "Terminé ✓",
    border: "border-l-[var(--color-primary)]",
    badge: "bg-[var(--color-primary)] text-white",
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

export default function ReservationsManuelles() {
  const { user, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const enabled =
    isAuthenticated &&
    (user?.role === "employe" || user?.role === "gerant" || user?.accountType === "employe");

  const { dashboard, isInitialLoading, isRefetching, refetch } = useGerantDashboard(Boolean(enabled));
  const { silentRefetch } = useGerantLiveInvalidate();

  const [manualLoading, setManualLoading] = useState(false);
  const { down: waDown } = useWhatsappInfra(true);
  const [dateFilter, setDateFilter] = useState<"today" | "week" | "all">("today");
  const [phoneFieldError, setPhoneFieldError] = useState<string | null>(null);
  const [devis, setDevis] = useState<{
    montant?: number;
    montant_avance?: number;
    montant_restant?: number;
    pourcentage_avance?: number;
    montant_commission?: number;
    commission_pourcentage?: number;
  } | null>(null);
  const [devisLoading, setDevisLoading] = useState(false);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [freeSlots, setFreeSlots] = useState<
    Array<{ heure_debut: string; heure_fin: string; label: string }>
  >([]);
  const [manual, setManual] = useState({
    joueur_nom: "",
    joueur_telephone: "",
    date: "",
    heure_debut: "",
    heure_fin: "",
    format_terrain: "entier" as "moitie" | "entier",
  });

  useEffect(() => {
    if (!enabled) {
      navigate("/login");
    }
  }, [enabled, navigate]);

  /** Charge les créneaux libres du jour sélectionné (pills — pas de saisie libre début/fin). */
  useEffect(() => {
    if (!manual.date) {
      setFreeSlots([]);
      setManual((m) => ({ ...m, heure_debut: "", heure_fin: "" }));
      return;
    }
    let cancelled = false;
    setSlotsLoading(true);
    gerantApi
      .disponibilites(manual.date)
      .then((data) => {
        if (cancelled) return;
        const slots = (data?.creneaux || [])
          .filter((s) => s.disponible !== false && (s.statut === "libre" || !s.statut || s.statut === "disponible"))
          .map((s) => {
            const debut = String(s.heure_debut || s.heure || "").slice(0, 5);
            const fin = String(s.heure_fin || "").slice(0, 5);
            return {
              heure_debut: debut,
              heure_fin: fin,
              label: fin ? `${debut} – ${fin}` : debut,
            };
          })
          .filter((s) => s.heure_debut);
        setFreeSlots(slots);
        setManual((m) => {
          const stillOk = slots.some(
            (s) => s.heure_debut === m.heure_debut && s.heure_fin === m.heure_fin,
          );
          if (stillOk) return m;
          return { ...m, heure_debut: "", heure_fin: "" };
        });
      })
      .catch(() => {
        if (!cancelled) {
          setFreeSlots([]);
          setManual((m) => ({ ...m, heure_debut: "", heure_fin: "" }));
        }
      })
      .finally(() => {
        if (!cancelled) setSlotsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [manual.date]);

  useEffect(() => {
    if (!manual.date || !manual.heure_debut || !manual.heure_fin) {
      setDevis(null);
      return;
    }
    let cancelled = false;
    setDevisLoading(true);
    const timer = window.setTimeout(() => {
      gerantApi
        .getDevis({
          date: manual.date,
          heure_debut: manual.heure_debut,
          heure_fin: manual.heure_fin,
          format: manual.format_terrain,
        })
        .then((payload) => {
          if (!cancelled) setDevis(payload as typeof devis);
        })
        .catch(() => {
          if (!cancelled) setDevis(null);
        })
        .finally(() => {
          if (!cancelled) setDevisLoading(false);
        });
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [manual.date, manual.heure_debut, manual.heure_fin, manual.format_terrain]);

  const load = () => {
    void refetch();
    void silentRefetch();
  };

  const filterReservations = (reservations: any[]) => {
    if (dateFilter === "all") return reservations;
    const today = new Date();
    const todayStr = localYmd();
    if (dateFilter === "today") {
      return reservations.filter((r: any) => r.date === todayStr);
    }
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - today.getDay() + 1);
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    return reservations.filter((r: any) => {
      const rDate = new Date(r.date);
      return rDate >= startOfWeek && rDate <= endOfWeek;
    });
  };

  const handleOpenFiche = (id: number) => {
    navigate(`/backoffice/gerant/reservations/${id}`);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!dashboard?.terrain?.id) return;

    const errPhone = phoneError(manual.joueur_telephone);
    if (errPhone) {
      setPhoneFieldError(errPhone);
      toast.error(errPhone);
      return;
    }
    setPhoneFieldError(null);
    if (!manual.date || !manual.heure_debut || !manual.heure_fin) {
      toast.error("Choisis un créneau libre dans la liste");
      return;
    }
    if (waDown) {
      toast.error(WHATSAPP_INFRA_MESSAGE);
      if (!confirmWhatsappAction(true)) return;
    }
    setManualLoading(true);
    try {
      const result = (await reservationsApi.createGerant({
        ...manual,
        joueur_telephone: toLocal9(manual.joueur_telephone),
        terrain_id: dashboard.terrain.id,
      })) as {
        whatsapp_sent?: boolean;
        whatsapp_error?: string | null;
        reservation_id?: number;
      };

      if (result?.whatsapp_sent) {
        const montant = Number((result as any)?.montant || devis?.montant || 0);
        toast.success(
          montant > 0
            ? `Lien WhatsApp envoyé · total ${montant.toLocaleString("fr-FR")} CFA`
            : "Réservation créée — lien WhatsApp envoyé au joueur",
        );
      } else {
        toast.warning(`Réservation créée, mais WhatsApp non envoyé. ${WHATSAPP_INFRA_MESSAGE}`);
      }

      setManual({
        joueur_nom: "",
        joueur_telephone: "",
        date: "",
        heure_debut: "",
        heure_fin: "",
        format_terrain: "entier",
      });
      setDevis(null);
      await load();
      if (result?.reservation_id) {
        navigate(`/backoffice/gerant/reservations/${result.reservation_id}`);
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setManualLoading(false);
    }
  };

  if (isInitialLoading) {
    return (
      <div className="text-[var(--color-text-secondary)] animate-pulse text-sm py-10 text-center">
        Chargement...
      </div>
    );
  }

  const allReservations = dashboard?.reservations || [];
  const filtered = filterReservations(allReservations);

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      <SilentSyncDot active={isRefetching} label="Synchronisation réservations" />
      <div>
        <h1
          className="text-xl font-semibold text-[var(--color-text-primary)]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Réservations
        </h1>
        <p className="text-sm text-[var(--color-text-secondary)] mt-1">
          Terrain : {dashboard?.terrain?.nom || "—"}
        </p>
      </div>

      <div className="flex gap-2 overflow-x-auto scrollbar-hide">
        {(
          [
            { id: "today" as const, label: "Aujourd'hui" },
            { id: "week" as const, label: "Cette semaine" },
            { id: "all" as const, label: "Tout" },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setDateFilter(t.id)}
            className={`px-4 min-h-[40px] rounded-full text-sm font-medium flex-shrink-0 ${
              dateFilter === t.id
                ? "bg-[var(--color-primary)] text-white"
                : "bg-white border border-[var(--color-border)] text-[var(--color-text-secondary)]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Mobile cards */}
      <div className="flex flex-col gap-3 md:hidden">
        {filtered.map((r: any) => {
          const meta = statusMeta[r.statut] || statusMeta.en_attente;
          return (
            <article
              key={r.id}
              className={`bg-white rounded-[var(--radius-md)] border border-[var(--color-border)] border-l-4 ${meta.border} p-4 shadow-sm`}
            >
              <div className="flex items-start justify-between gap-2">
                <button
                  type="button"
                  className="min-w-0 text-left"
                  onClick={() => navigate(`/backoffice/gerant/reservations/${r.id}`)}
                >
                  <p
                    className="font-semibold text-sm truncate"
                    style={{ fontFamily: "var(--font-display)" }}
                  >
                    {r.joueur_nom}
                  </p>
                  <div className="mt-1.5">
                    <ReservationDatesBlock
                      compact
                      createdAt={r.created_at}
                      date={r.date}
                      heureDebut={r.heure_debut}
                      heureFin={r.heure_fin}
                    />
                  </div>
                </button>
                <span className={`text-[10px] font-medium px-2.5 py-1 rounded-full ${meta.badge}`}>
                  {meta.label}
                </span>
              </div>
              {(r.statut === "en_attente" || r.statut === "en_attente_paiement") ? (
                <PaymentLockGauge
                  className="mt-2"
                  expiresAt={Number(r.verrou_expire_at)}
                  startedAt={r.created_at}
                      onExpired={() => void load()}
                    />
                  ) : null}
                  <p className="text-xs text-[var(--color-text-secondary)] mt-2">
                    {(r.montant || 0).toLocaleString()} CFA ·{" "}
                    {r.format_terrain === "moitie" ? "Moitié" : "Entier"}
                    {r.code_reservation ? (
                      <span className="block mt-1 font-semibold text-[var(--color-primary)]">
                        Code : {r.code_reservation}
                      </span>
                    ) : null}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {(r.statut === "en_attente" || r.statut === "en_attente_paiement") && (
                      <div className="w-full">
                        <EnAttentePaiementActions
                          reservationId={r.id}
                          montantAvance={r.montant_avance ?? r.acompte}
                          features={dashboard?.features || null}
                          variant="compact"
                          onDone={() => void load()}
                        />
                      </div>
                    )}
                {r.statut === "confirme" && (
                  <button
                    type="button"
                    onClick={() => handleOpenFiche(r.id)}
                    className="min-h-[44px] px-4 rounded-[var(--radius-sm)] bg-[var(--color-primary)] text-white text-xs font-medium"
                  >
                    Ouvrir la fiche / scanner
                  </button>
                )}
              </div>
            </article>
          );
        })}
        {filtered.length === 0 && (
          <p className="text-sm text-[var(--color-text-muted)] text-center py-8">
            Aucune réservation
          </p>
        )}
      </div>

      {/* Desktop table */}
      <div className="hidden md:block overflow-x-auto rounded-[var(--radius-md)] border border-[var(--color-border)] bg-white">
        <table className="bo-table">
          <thead>
            <tr>
              <th>Joueur</th>
              <th>Code</th>
              <th>Jour du match</th>
              <th>Réservé le</th>
              <th>Montant</th>
              <th>Statut</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r: any) => {
              const meta = statusMeta[r.statut] || statusMeta.en_attente;
              return (
                <tr key={r.id}>
                  <td className="font-medium">
                    <button
                      type="button"
                      className="hover:underline text-left"
                      onClick={() => navigate(`/backoffice/gerant/reservations/${r.id}`)}
                    >
                      {r.joueur_nom}
                    </button>
                  </td>
                  <td className="font-semibold text-[var(--color-primary)] text-xs">
                    {r.code_reservation || "—"}
                  </td>
                  <td className="text-xs">
                    <ReservationDatesBlock
                      compact
                      createdAt={null}
                      date={r.date}
                      heureDebut={r.heure_debut}
                      heureFin={r.heure_fin}
                    />
                  </td>
                  <td className="text-xs text-[var(--color-text-muted)]">
                    {r.created_at
                      ? new Date(String(r.created_at).includes("T") ? r.created_at : String(r.created_at).replace(" ", "T")).toLocaleString("fr-FR", {
                          day: "2-digit",
                          month: "2-digit",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "—"}
                    {(r.statut === "en_attente" || r.statut === "en_attente_paiement") ? (
                      <PaymentLockGauge
                        className="mt-2 max-w-[140px]"
                        expiresAt={Number(r.verrou_expire_at)}
                        startedAt={r.created_at}
                        onExpired={() => void load()}
                      />
                    ) : null}
                  </td>
                  <td className="font-semibold text-[var(--color-primary)]">
                    {(r.montant || 0).toLocaleString()} CFA
                  </td>
                  <td>
                    <span className={`text-[10px] font-medium px-2.5 py-1 rounded-full ${meta.badge}`}>
                      {meta.label}
                    </span>
                  </td>
                  <td className="space-y-2 min-w-[220px]">
                    {(r.statut === "en_attente" || r.statut === "en_attente_paiement") && (
                      <EnAttentePaiementActions
                        reservationId={r.id}
                        montantAvance={r.montant_avance ?? r.acompte}
                        features={dashboard?.features || null}
                        variant="compact"
                        onDone={() => void load()}
                      />
                    )}
                    {r.statut === "confirme" ? (
                      <button
                        type="button"
                        onClick={() => handleOpenFiche(r.id)}
                        className="text-xs font-medium text-[var(--color-primary)] hover:underline"
                      >
                        Fiche / scanner
                      </button>
                    ) : r.statut !== "en_attente" && r.statut !== "en_attente_paiement" ? (
                      "—"
                    ) : null}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center text-[var(--color-text-muted)] py-8">
                  Aucune réservation
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Réservation manuelle */}
      <section>
        <h2 className="section-title mb-4">Réservation manuelle</h2>
        <form
          className="bg-white rounded-[var(--radius-lg)] border border-[var(--color-border)] p-5 sm:p-6 grid grid-cols-1 sm:grid-cols-2 gap-4 shadow-sm"
          onSubmit={handleSubmit}
        >
          <div className="sm:col-span-1">
            <label className="text-xs font-medium text-[var(--color-text-secondary)] mb-1.5 block">
              Nom du joueur
            </label>
            <input
              required
              placeholder="Amadou Diallo"
              value={manual.joueur_nom}
              onChange={(e) => setManual({ ...manual, joueur_nom: e.target.value })}
              className="w-full h-[52px] rounded-[var(--radius-md)] border border-[var(--color-border)] px-4 text-sm outline-none focus:border-[var(--color-primary)]"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-[var(--color-text-secondary)] mb-1.5 block">
              Téléphone WhatsApp
            </label>
            <div className="flex items-center gap-2 h-[52px] rounded-[var(--radius-md)] border border-[var(--color-border)] px-4 focus-within:border-[var(--color-primary)]">
              <span className="text-sm text-[var(--color-text-muted)] select-none">+221</span>
              <input
                required
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                placeholder="77 826 12 25"
                value={manual.joueur_telephone}
                onChange={(e) => {
                  const formatted = formatPhoneDisplay(e.target.value);
                  setManual({ ...manual, joueur_telephone: formatted });
                  setPhoneFieldError(formatted ? phoneError(formatted) : null);
                }}
                className="flex-1 h-full bg-transparent outline-none text-sm min-w-[8rem]"
              />
            </div>
            {phoneFieldError && (
              <p className="text-xs text-[var(--color-danger)] mt-1">{phoneFieldError}</p>
            )}
            <p className="text-[11px] text-[var(--color-text-muted)] mt-1">
              9 chiffres sans l&apos;indicatif (ex. 77 826 12 25)
            </p>
          </div>
          <div>
            <label className="text-xs font-medium text-[var(--color-text-secondary)] mb-1.5 block">
              Format
            </label>
            <Select2
              value={manual.format_terrain}
              onChange={(v) => setManual({ ...manual, format_terrain: v as "moitie" | "entier" })}
              options={[
                { value: "moitie", label: "Moitié du terrain" },
                { value: "entier", label: "Terrain entier" },
              ]}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-[var(--color-text-secondary)] mb-1.5 block">
              Date
            </label>
            <input
              required
              type="date"
              value={manual.date}
              onChange={(e) => setManual({ ...manual, date: e.target.value })}
              className="w-full h-[52px] rounded-[var(--radius-md)] border border-[var(--color-border)] px-4 text-sm outline-none focus:border-[var(--color-primary)]"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="text-xs font-medium text-[var(--color-text-secondary)] mb-1.5 block">
              Créneau libre
            </label>
            {!manual.date ? (
              <p className="text-sm text-[var(--color-text-muted)]">
                Sélectionne d&apos;abord une date pour voir les créneaux libres.
              </p>
            ) : slotsLoading ? (
              <p className="text-sm text-[var(--color-text-secondary)] animate-pulse">Chargement des créneaux…</p>
            ) : freeSlots.length === 0 ? (
              <p className="text-sm text-[var(--color-text-muted)]">
                Aucun créneau libre ce jour — choisis une autre date.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {freeSlots.map((slot) => {
                  const selected =
                    manual.heure_debut === slot.heure_debut && manual.heure_fin === slot.heure_fin;
                  return (
                    <button
                      key={`${slot.heure_debut}-${slot.heure_fin}`}
                      type="button"
                      onClick={() =>
                        setManual({
                          ...manual,
                          heure_debut: slot.heure_debut,
                          heure_fin: slot.heure_fin,
                        })
                      }
                      className={`min-h-[44px] px-3.5 rounded-xl border text-sm font-semibold transition-colors ${
                        selected
                          ? "border-[var(--color-primary)] bg-[var(--color-primary)] text-white"
                          : "border-[var(--color-border)] bg-white text-[var(--color-primary)] hover:border-[var(--color-primary)]"
                      }`}
                    >
                      {slot.label}
                    </button>
                  );
                })}
              </div>
            )}
            {!manual.heure_debut && manual.date && freeSlots.length > 0 ? (
              <p className="text-[11px] text-[var(--color-text-muted)] mt-1.5">
                Touche un créneau pour le sélectionner (pas de saisie manuelle début/fin).
              </p>
            ) : null}
          </div>

          {(devisLoading || devis) && (
            <div className="sm:col-span-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-primary)_6%,white)] p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)] mb-2">
                Devis dynamique (grille Tarifs)
              </p>
              {devisLoading && !devis ? (
                <p className="text-sm text-[var(--color-text-secondary)] animate-pulse">Calcul…</p>
              ) : (
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <p className="text-[10px] text-[var(--color-text-muted)]">Total</p>
                    <p className="font-semibold">
                      {Number(devis?.montant || 0).toLocaleString("fr-FR")} CFA
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-[var(--color-text-muted)]">
                      Avance
                      {devis?.pourcentage_avance != null
                        ? ` (${devis.pourcentage_avance}%)`
                        : ""}
                    </p>
                    <p className="font-semibold text-[var(--color-primary)]">
                      {Number(devis?.montant_avance || 0).toLocaleString("fr-FR")} CFA
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-[var(--color-text-muted)]">Reste sur place</p>
                    <p className="font-semibold">
                      {Number(devis?.montant_restant || 0).toLocaleString("fr-FR")} CFA
                    </p>
                  </div>
                </div>
              )}
              {devis?.montant_commission != null && Number(devis.montant_commission) > 0 ? (
                <p className="text-[11px] text-[var(--color-text-muted)] mt-2">
                  Commission plateforme ({devis.commission_pourcentage ?? "—"}% de l&apos;avance) :{" "}
                  {Number(devis.montant_commission).toLocaleString("fr-FR")} CFA — distincte de
                  l&apos;avance joueur
                </p>
              ) : (
                <p className="text-[11px] text-[var(--color-text-muted)] mt-2">
                  Même prix que le joueur verra · créneau déjà pris → refus automatique
                </p>
              )}
            </div>
          )}

          <button
            type="submit"
            disabled={manualLoading}
            className="sm:col-span-2 w-full min-h-[52px] rounded-[var(--radius-md)] bg-[var(--color-primary)] text-white text-sm font-medium hover:bg-[var(--color-primary-light)] disabled:bg-[var(--color-text-muted)] inline-flex items-center justify-center gap-2"
          >
            <MessageCircle className="w-4 h-4" />
            {manualLoading
              ? "Création..."
              : devis?.montant_avance
                ? `Créer · avance ${Number(devis.montant_avance).toLocaleString("fr-FR")} CFA`
                : "Créer et envoyer le lien WhatsApp"}
          </button>
        </form>
      </section>
    </div>
  );
}
