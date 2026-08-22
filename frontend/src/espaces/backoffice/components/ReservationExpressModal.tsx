import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, X, AlertTriangle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { formatPhoneDisplay, phoneError, toLocal9 } from "@/auth/phone";
import { gerantApi, reservationsApi, terrainsApi } from "@/lib/api";
import { localYmd } from "@/lib/localDate";
import { cn, formatFcfa } from "@/lib/utils";
import { useWhatsappInfra } from "@/hooks/useWhatsappInfra";
import { WHATSAPP_INFRA_MESSAGE } from "@/lib/whatsappMessages";

type JoueurConnu = {
  id: number;
  display_nom: string;
  prenom?: string | null;
  nom?: string | null;
  telephone?: string | null;
};

type Prefill = {
  date?: string;
  heure_debut?: string;
  heure_fin?: string;
};

type Slot = {
  heure: string;
  heure_fin?: string;
  disponible?: boolean;
  statut?: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  terrainId?: number;
  prefill?: Prefill | null;
  onCreated?: () => void;
};

type Step = 1 | 2 | 3;

function toLocalISO(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatHourLabel(h: string) {
  if (!h) return "";
  const [hh, mm = "00"] = h.split(":");
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function formatHourPill(h: string) {
  return formatHourLabel(h).replace(":", "h");
}

function getEndTime(startSlot: string, durationHours: number) {
  const [hh, mm = "00"] = String(startSlot).slice(0, 5).split(":");
  const total = parseInt(hh, 10) * 60 + parseInt(mm, 10) + Math.round(durationHours * 60);
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

const DUREES_EXPRESS = [
  { label: "1h", hours: 1 },
  { label: "1h30", hours: 1.5 },
  { label: "2h", hours: 2 },
  { label: "3h", hours: 3 },
] as const;

function formatDureeLabel(hours: number) {
  if (hours === 1.5) return "1h30";
  if (hours === 1) return "1h";
  return `${hours}h`;
}

function buildDateChips(count = 7) {
  return Array.from({ length: count }, (_, i) => {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() + i);
    return {
      day: d.getDate(),
      weekday: ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"][d.getDay()],
      isToday: i === 0,
      isoDate: toLocalISO(d),
      shortLabel: i === 0 ? "Auj." : i === 1 ? "Demain" : null,
    };
  });
}

function splitDisplayNom(display: string) {
  const parts = String(display || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return { prenom: "", nom: "" };
  if (parts.length === 1) return { prenom: parts[0], nom: "" };
  return { prenom: parts[0], nom: parts.slice(1).join(" ") };
}

function initialsFrom(prenom: string, nom: string, display?: string) {
  const a = (prenom || display || "?").trim().charAt(0);
  const b = (nom || "").trim().charAt(0);
  return `${a}${b}`.toUpperCase() || "?";
}

export default function ReservationExpressModal({
  open,
  onClose,
  terrainId,
  prefill,
  onCreated,
}: Props) {
  const navigate = useNavigate();
  const lockedCreneau = Boolean(prefill?.date && prefill?.heure_debut && prefill?.heure_fin);
  const dates = useMemo(() => buildDateChips(7), []);
  const todayIso = localYmd();

  const [step, setStep] = useState<Step>(1);
  const [dateSelectionnee, setDateSelectionnee] = useState(todayIso);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [selectedDuration, setSelectedDuration] = useState(1);
  const [heureDebutManuelle, setHeureDebutManuelle] = useState("");
  const [heureFinManuelle, setHeureFinManuelle] = useState("");
  const [modeHoraire, setModeHoraire] = useState<"liste" | "manuel">("liste");
  const [verifState, setVerifState] = useState<"idle" | "loading" | "ok" | "conflit">("idle");
  const [verifMsg, setVerifMsg] = useState<string | null>(null);
  const [formatTerrain, setFormatTerrain] = useState<"moitie" | "entier">("entier");
  const [creneaux, setCreneaux] = useState<Slot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [terrainPrix, setTerrainPrix] = useState<{ moitie: number; entier: number }>({
    moitie: 0,
    entier: 0,
  });

  const [joueurTel, setJoueurTel] = useState("");
  const [joueurPrenom, setJoueurPrenom] = useState("");
  const [joueurNomFamille, setJoueurNomFamille] = useState("");
  const [joueurId, setJoueurId] = useState<number | null>(null);
  const [joueurConnu, setJoueurConnu] = useState<JoueurConnu | null>(null);
  const [lookupState, setLookupState] = useState<"idle" | "loading" | "connu" | "nouveau">("idle");
  const [devis, setDevis] = useState<{
    montant: number;
    montant_avance: number;
    montant_restant: number;
    montant_commission?: number;
  } | null>(null);
  const [payChoice, setPayChoice] = useState<"lien" | "manuel">("lien");
  const [noteManuel, setNoteManuel] = useState("");
  const [busy, setBusy] = useState(false);
  const [waConnected, setWaConnected] = useState<boolean | null>(null);
  const { down: waDown } = useWhatsappInfra(open);
  const [doneMsg, setDoneMsg] = useState<string | null>(null);

  const selectedDate = dateSelectionnee || todayIso;
  const heureFin =
    modeHoraire === "manuel" && heureDebutManuelle && heureFinManuelle
      ? formatHourLabel(heureFinManuelle)
      : selectedSlot
        ? getEndTime(selectedSlot, selectedDuration)
        : null;
  const heureDebutEffective =
    modeHoraire === "manuel" && heureDebutManuelle
      ? formatHourLabel(heureDebutManuelle)
      : selectedSlot;
  const telLocal = toLocal9(joueurTel);
  const telError = joueurTel.trim() ? phoneError(joueurTel) : "Numéro de téléphone requis";
  const displayNom = (
    joueurConnu?.display_nom || [joueurPrenom, joueurNomFamille].filter(Boolean).join(" ")
  ).trim();

  const freeSlots = useMemo(
    () => creneaux.filter((s) => s.disponible !== false && s.statut !== "bloque"),
    [creneaux],
  );
  const noFreeToday = selectedDate === todayIso && !loadingSlots && freeSlots.length === 0 && !lockedCreneau;

  useEffect(() => {
    if (!open) return;

    const iso = prefill?.date || localYmd();
    setStep(1);
    setDateSelectionnee(iso);
    setSelectedSlot(prefill?.heure_debut ? formatHourLabel(prefill.heure_debut) : null);
    setHeureDebutManuelle(prefill?.heure_debut ? formatHourLabel(prefill.heure_debut) : "");
    setHeureFinManuelle(prefill?.heure_fin ? formatHourLabel(prefill.heure_fin) : "");
    setModeHoraire(prefill?.heure_debut && prefill?.heure_fin ? "liste" : "liste");
    setVerifState("idle");
    setVerifMsg(null);
    if (prefill?.heure_debut && prefill?.heure_fin) {
      const startM =
        parseInt(prefill.heure_debut.slice(0, 2), 10) * 60 +
        parseInt(prefill.heure_debut.slice(3, 5) || "0", 10);
      const endM =
        parseInt(prefill.heure_fin.slice(0, 2), 10) * 60 +
        parseInt(prefill.heure_fin.slice(3, 5) || "0", 10);
      let durH = (endM - startM) / 60;
      if (!(durH > 0)) durH = 1;
      const match = DUREES_EXPRESS.find((d) => Math.abs(d.hours - durH) < 0.01);
      setSelectedDuration(match ? match.hours : Math.min(3, Math.max(1, Math.round(durH))));
    } else {
      setSelectedDuration(1);
    }
    setFormatTerrain("entier");
    setJoueurTel("");
    setJoueurPrenom("");
    setJoueurNomFamille("");
    setJoueurId(null);
    setJoueurConnu(null);
    setLookupState("idle");
    setDevis(null);
    setBusy(false);
    setDoneMsg(null);
    gerantApi
      .whatsappStatus()
      .then((s: any) => setWaConnected(Boolean(s?.connected) && !s?.mock))
      .catch(() => setWaConnected(null));
  }, [open, prefill]);

  useEffect(() => {
    if (!open || !terrainId) return;
    terrainsApi
      .get(terrainId)
      .then((t: any) => {
        setTerrainPrix({
          moitie: Number(t?.prix_moitie || 0),
          entier: Number(t?.prix_entier || t?.prix_heure || 0),
        });
      })
      .catch(() => setTerrainPrix({ moitie: 0, entier: 0 }));
  }, [open, terrainId]);

  useEffect(() => {
    if (!open || !terrainId || !selectedDate) return;
    let cancelled = false;
    setLoadingSlots(true);
    const dureeMin = Math.round(selectedDuration * 60);
    terrainsApi
      .getCreneaux(terrainId, selectedDate, { duree_minutes: dureeMin })
      .then((data: any) => {
        if (cancelled) return;
        let slots: Slot[] = (data?.creneaux || []).map((s: any) => ({
          heure: s.heure || s.heure_debut,
          heure_fin: s.heure_fin,
          disponible: s.disponible,
          statut: s.statut,
        }));
        if (slots.length === 0) {
          slots = ["18:00", "19:00", "20:00", "21:00"].map((heure) => ({
            heure,
            heure_fin: getEndTime(heure, 1),
            disponible: true,
            statut: "libre",
          }));
        }
        setCreneaux(slots);
      })
      .catch(() => {
        if (cancelled) return;
        setCreneaux(
          ["18:00", "19:00", "20:00", "21:00"].map((heure) => ({
            heure,
            heure_fin: getEndTime(heure, 1),
            disponible: true,
            statut: "libre",
          })),
        );
      })
      .finally(() => {
        if (!cancelled) setLoadingSlots(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, terrainId, selectedDate, selectedDuration]);

  useEffect(() => {
    if (!open || !terrainId || !heureDebutEffective || !heureFin) {
      setVerifState("idle");
      setVerifMsg(null);
      return;
    }
    let cancelled = false;
    setVerifState("loading");
    const t = window.setTimeout(() => {
      reservationsApi
        .verifierDisponibilite({
          terrain_id: terrainId,
          date: selectedDate,
          heure_debut: heureDebutEffective,
          heure_fin: heureFin,
        })
        .then((res) => {
          if (cancelled) return;
          if (res.disponible) {
            setVerifState("ok");
            setVerifMsg(
              `✓ Créneau disponible · Durée : ${res.duree_label || formatDureeLabel(selectedDuration)}`,
            );
          } else {
            const c = res.conflits?.[0];
            setVerifState("conflit");
            setVerifMsg(
              c
                ? `✗ Conflit avec ${c.joueur_nom || "une réservation"} de ${formatHourPill(c.heure_debut)} à ${formatHourPill(c.heure_fin)}`
                : "✗ Créneau indisponible",
            );
          }
        })
        .catch(() => {
          if (cancelled) return;
          setVerifState("idle");
          setVerifMsg(null);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [open, terrainId, selectedDate, heureDebutEffective, heureFin, selectedDuration]);
  useEffect(() => {
    if (!open || telLocal.length !== 9) {
      setLookupState("idle");
      setJoueurConnu(null);
      setJoueurId(null);
      return;
    }
    if (phoneError(joueurTel)) {
      setLookupState("idle");
      setJoueurConnu(null);
      setJoueurId(null);
      return;
    }

    let cancelled = false;
    setLookupState("loading");
    gerantApi
      .joueurByTelephone(telLocal)
      .then((data) => {
        if (cancelled) return;
        if (data?.trouve && data.joueur) {
          const known = data.joueur;
          const split = splitDisplayNom(known.display_nom);
          const prenomDb = String(known.prenom || "").trim();
          const nomDb = String(known.nom || "").trim();
          const prenom = prenomDb || split.prenom;
          const nom = prenomDb
            ? nomDb.startsWith(prenom) && nomDb !== prenom
              ? nomDb.slice(prenom.length).trim()
              : nomDb === prenom
                ? ""
                : nomDb
            : split.nom;
          setJoueurConnu(known);
          setJoueurId(known.id);
          setJoueurPrenom(prenom);
          setJoueurNomFamille(nom);
          setLookupState("connu");
        } else {
          setJoueurConnu(null);
          setJoueurId(null);
          setLookupState("nouveau");
        }
      })
      .catch(() => {
        if (cancelled) return;
        setJoueurConnu(null);
        setJoueurId(null);
        setLookupState("nouveau");
      });

    return () => {
      cancelled = true;
    };
  }, [open, telLocal, joueurTel]);

  useEffect(() => {
    if (!open || !heureDebutEffective || !heureFin) {
      setDevis(null);
      return;
    }
    let cancelled = false;
    const t = window.setTimeout(() => {
      gerantApi
        .getDevis({
          date: selectedDate,
          heure_debut: heureDebutEffective,
          heure_fin: heureFin,
          format: formatTerrain,
        })
        .then((payload: any) => {
          if (cancelled) return;
          const montant = Number(payload?.montant);
          const avance = Number(payload?.montant_avance);
          const restant = Number(payload?.montant_restant);
          if (Number.isFinite(montant) && montant > 0) {
            setDevis({
              montant,
              montant_avance: Number.isFinite(avance) ? avance : Math.round(montant * 0.125),
              montant_restant: Number.isFinite(restant)
                ? restant
                : Math.max(0, montant - (Number.isFinite(avance) ? avance : Math.round(montant * 0.125))),
              montant_commission: Number(payload?.montant_commission || 0),
            });
            return;
          }
          const hourly = formatTerrain === "moitie" ? terrainPrix.moitie : terrainPrix.entier;
          const total = Math.round(hourly * selectedDuration);
          const av = Math.round(total * 0.125);
          setDevis({ montant: total, montant_avance: av, montant_restant: Math.max(0, total - av) });
        })
        .catch(() => {
          if (cancelled) return;
          const hourly = formatTerrain === "moitie" ? terrainPrix.moitie : terrainPrix.entier;
          const total = hourly > 0 ? Math.round(hourly * selectedDuration) : 0;
          const av = Math.round(total * 0.125);
          setDevis(total > 0 ? { montant: total, montant_avance: av, montant_restant: total - av } : null);
        });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [
    open,
    heureDebutEffective,
    heureFin,
    selectedDate,
    formatTerrain,
    selectedDuration,
    terrainPrix.moitie,
    terrainPrix.entier,
  ]);

  if (!open) return null;

  const canGoStep2 = Boolean(heureDebutEffective && heureFin && verifState !== "conflit");
  const canGoStep3 = Boolean(!telError && displayNom);

  const submitPaiement = async () => {
    if (!terrainId) {
      toast.error("Terrain introuvable");
      return;
    }
    if (!heureDebutEffective || !heureFin) {
      toast.error("Choisis un créneau");
      return;
    }
    const nom = displayNom;
    if (!nom) {
      toast.error("Indique le prénom et le nom du joueur");
      return;
    }
    const errPhone = phoneError(joueurTel);
    if (errPhone) {
      toast.error(errPhone);
      return;
    }
    if (waDown) {
      toast.error(WHATSAPP_INFRA_MESSAGE);
    } else if (waConnected === false) {
      toast.message("WhatsApp gérant non connecté : le lien pourra être renvoyé plus tard.");
    }

    setBusy(true);
    try {
      const result = (await reservationsApi.createGerant({
        terrain_id: terrainId,
        date: selectedDate,
        heure_debut: heureDebutEffective,
        heure_fin: heureFin,
        joueur_nom: nom,
        joueur_prenom: joueurPrenom.trim() || undefined,
        joueur_telephone: toLocal9(joueurTel),
        format_terrain: formatTerrain,
        joueur_id: joueurId || undefined,
        mode: "paiement",
      })) as {
        reservation_id?: number;
        whatsapp_sent?: boolean;
        whatsapp_error?: string | null;
        joueur_nom?: string;
        mode?: string;
      };

      onCreated?.();

      const prenom = String(result?.joueur_nom || nom).split(" ")[0];
      if (result?.whatsapp_sent) {
        setDoneMsg(`Lien envoyé à ${prenom} ✓`);
        toast.success(`Lien envoyé à ${prenom} ✓`);
      } else {
        setDoneMsg(`Réservation créée — lien à renvoyer`);
        toast.warning(
          result?.whatsapp_error
            ? WHATSAPP_INFRA_MESSAGE
            : "Créée — pense à renvoyer le lien",
        );
      }

      window.setTimeout(() => {
        onClose();
        if (result?.reservation_id) {
          navigate(`/backoffice/gerant/reservations/${result.reservation_id}`);
        }
      }, 900);
    } catch (err: any) {
      toast.error(err?.message || "Création impossible");
    } finally {
      setBusy(false);
    }
  };

  const submitManuel = async () => {
    if (!terrainId) {
      toast.error("Terrain introuvable");
      return;
    }
    if (!heureDebutEffective || !heureFin) {
      toast.error("Choisis un créneau");
      return;
    }
    const nom = displayNom;
    if (!nom) {
      toast.error("Indique le prénom et le nom du joueur");
      return;
    }
    const errPhone = phoneError(joueurTel);
    if (errPhone) {
      toast.error(errPhone);
      return;
    }
    setBusy(true);
    try {
      const created = (await reservationsApi.createGerant({
        terrain_id: terrainId,
        date: selectedDate,
        heure_debut: heureDebutEffective,
        heure_fin: heureFin,
        joueur_nom: nom,
        joueur_prenom: joueurPrenom.trim() || undefined,
        joueur_telephone: toLocal9(joueurTel),
        format_terrain: formatTerrain,
        joueur_id: joueurId || undefined,
        mode: "manuel",
      })) as { reservation_id?: number };
      if (!created?.reservation_id) throw new Error("Réservation non créée");
      await gerantApi.confirmerManuellement(created.reservation_id, noteManuel.trim() || undefined);
      onCreated?.();
      setDoneMsg("Réservation confirmée ✓ — Commission en dette");
      toast.success("Réservation confirmée ✓ — Commission en dette");
      window.setTimeout(() => {
        onClose();
        navigate(`/backoffice/gerant/reservations/${created.reservation_id}`);
      }, 900);
    } catch (err: any) {
      toast.error(err?.message || "Confirmation manuelle impossible");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center md:items-center">
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        aria-label="Fermer"
        onClick={() => {
          if (!busy) onClose();
        }}
      />
      <div className="relative flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-white pb-[max(1rem,env(safe-area-inset-bottom))] shadow-xl dark:bg-[var(--surface)] md:rounded-2xl">
        <div className="flex justify-center pb-1 pt-3 md:hidden">
          <span className="h-1 w-10 rounded-full bg-neutral-300" />
        </div>

        <div className="flex items-start justify-between gap-2 px-4 pb-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {step > 1 && !doneMsg && (
                <button
                  type="button"
                  onClick={() => setStep((s) => (s === 3 ? 2 : 1))}
                  className="flex h-9 w-9 items-center justify-center rounded-full"
                  style={{ background: "var(--g-surface-2)" }}
                  aria-label="Étape précédente"
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
              )}
              <h2 className="text-base font-bold text-[var(--text-primary)]">Nouvelle réservation</h2>
            </div>
            <p className="mt-0.5 text-xs text-neutral-400">
              Étape {step}/3
              {step === 1 && " — Créneau"}
              {step === 2 && " — Joueur"}
              {step === 3 && " — Paiement"}
            </p>
            {waConnected === false && step === 3 ? (
              <p className="mt-1 text-[11px] font-medium text-amber-600">
                WhatsApp non connecté : le lien ne partira pas automatiquement.
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => {
              if (!busy) onClose();
            }}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center"
            aria-label="Fermer"
          >
            <X className="h-5 w-5 text-neutral-400" />
          </button>
        </div>

        <div className="flex gap-1.5 px-4 pb-3">
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              className={cn("h-1 flex-1 rounded-full", n <= step ? "bg-[var(--g-primary)]" : "bg-neutral-200")}
            />
          ))}
        </div>

        {doneMsg ? (
          <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
            <CheckCircle2 className="h-14 w-14 text-[var(--g-primary)]" />
            <p className="text-lg font-bold text-[var(--text-primary)]">{doneMsg}</p>
          </div>
        ) : (
          <div className="flex flex-1 flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto px-4 pb-4">
              {step === 1 && (
                <div className="space-y-4">
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
                      Date
                    </p>
                    <div className="scrollbar-none flex snap-x gap-2 overflow-x-auto">
                      {dates.map((d) => {
                        const active = dateSelectionnee === d.isoDate;
                        return (
                          <button
                            key={d.isoDate}
                            type="button"
                            disabled={lockedCreneau && d.isoDate !== selectedDate}
                            onClick={() => {
                              setDateSelectionnee(d.isoDate);
                              if (!lockedCreneau) setSelectedSlot(null);
                            }}
                            className={cn(
                              "relative flex min-h-[70px] w-[58px] min-w-[58px] snap-start flex-col items-center justify-center rounded-xl py-2 text-[11px] font-medium",
                              active
                                ? "bg-[var(--g-primary)] text-white shadow-sm"
                                : d.isToday
                                  ? "border-2 border-[var(--g-primary-light)] bg-[var(--g-primary-glow)] text-[var(--g-primary)]"
                                  : "border border-gray-200 bg-white text-[var(--text-secondary)]",
                            )}
                          >
                            <span className="opacity-80">{d.shortLabel || d.weekday}</span>
                            <span className="mt-0.5 text-[18px] font-bold">{d.day}</span>
                          </button>
                        );
                      })}
                    </div>
                    {noFreeToday ? (
                      <p className="mt-2 text-xs text-amber-600">
                        Aucun créneau libre aujourd&apos;hui — choisis une autre date.
                      </p>
                    ) : null}
                  </div>

                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
                      Durée
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {DUREES_EXPRESS.map((d) => (
                        <button
                          key={d.label}
                          type="button"
                          disabled={lockedCreneau}
                          onClick={() => {
                            setSelectedDuration(d.hours);
                            if (modeHoraire === "liste") setSelectedSlot(null);
                          }}
                          className={cn(
                            "min-h-[44px] min-w-[56px] flex-1 rounded-xl text-sm font-semibold",
                            selectedDuration === d.hours
                              ? "bg-[var(--g-primary)] text-white"
                              : "border border-gray-200 bg-white text-[var(--text-secondary)]",
                          )}
                        >
                          {d.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setModeHoraire("liste")}
                      className={cn(
                        "flex-1 min-h-[36px] rounded-lg text-xs font-semibold",
                        modeHoraire === "liste"
                          ? "bg-[var(--g-primary)] text-white"
                          : "bg-neutral-100 text-neutral-500",
                      )}
                    >
                      Liste des libres
                    </button>
                    <button
                      type="button"
                      onClick={() => setModeHoraire("manuel")}
                      disabled={lockedCreneau}
                      className={cn(
                        "flex-1 min-h-[36px] rounded-lg text-xs font-semibold",
                        modeHoraire === "manuel"
                          ? "bg-[var(--g-primary)] text-white"
                          : "bg-neutral-100 text-neutral-500",
                      )}
                    >
                      Début / Fin
                    </button>
                  </div>

                  {modeHoraire === "manuel" ? (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="mb-1 block text-[11px] font-semibold text-neutral-400">
                          Heure de début
                        </label>
                        <input
                          type="time"
                          value={heureDebutManuelle}
                          disabled={lockedCreneau}
                          onChange={(e) => {
                            setHeureDebutManuelle(e.target.value);
                            setSelectedSlot(formatHourLabel(e.target.value));
                          }}
                          className="w-full min-h-[44px] rounded-xl border border-gray-200 px-3 text-sm"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-[11px] font-semibold text-neutral-400">
                          Heure de fin
                        </label>
                        <input
                          type="time"
                          value={heureFinManuelle}
                          disabled={lockedCreneau}
                          onChange={(e) => setHeureFinManuelle(e.target.value)}
                          className="w-full min-h-[44px] rounded-xl border border-gray-200 px-3 text-sm"
                        />
                      </div>
                    </div>
                  ) : (
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
                      Créneaux libres
                    </p>
                    {loadingSlots ? (
                      <div className="grid grid-cols-1 gap-2">
                        {Array.from({ length: 4 }).map((_, i) => (
                          <div key={i} className="h-12 animate-pulse rounded-xl bg-neutral-100" />
                        ))}
                      </div>
                    ) : freeSlots.length === 0 ? (
                      <p className="py-6 text-center text-sm text-neutral-400">
                        Aucun créneau libre ce jour
                      </p>
                    ) : (
                      <div className="flex flex-col gap-2">
                        {freeSlots.map((slot) => {
                          const heure = formatHourLabel(slot.heure);
                          const fin = formatHourLabel(slot.heure_fin || getEndTime(heure, selectedDuration));
                          const selected = selectedSlot === heure;
                          const long = selectedDuration > 1;
                          return (
                            <button
                              key={heure}
                              type="button"
                              disabled={lockedCreneau && heure !== selectedSlot}
                              onClick={() => setSelectedSlot(heure)}
                              className={cn(
                                "min-h-[48px] rounded-xl border px-4 text-left text-sm font-semibold transition-colors",
                                long ? "py-3" : "",
                                selected
                                  ? "border-[var(--g-primary)] bg-[var(--g-primary)] text-white"
                                  : "border-gray-200 bg-white text-[var(--g-primary)]",
                              )}
                            >
                              {formatHourPill(heure)} - {formatHourPill(fin)}
                              <span className={cn("ml-1 font-normal opacity-70", selected ? "text-white/80" : "")}>
                                · {formatDureeLabel(selectedDuration)}
                              </span>
                              {long ? (
                                <span
                                  className={cn(
                                    "ml-2 inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold",
                                    selected ? "bg-white/20 text-white" : "bg-blue-50 text-blue-600",
                                  )}
                                >
                                  {formatDureeLabel(selectedDuration)}
                                </span>
                              ) : null}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  )}

                  {verifState !== "idle" ? (
                    <div
                      className={cn(
                        "rounded-xl px-3 py-2 text-xs font-semibold",
                        verifState === "ok" && "bg-emerald-50 text-emerald-700",
                        verifState === "conflit" && "bg-red-50 text-red-700",
                        verifState === "loading" && "bg-neutral-50 text-neutral-500",
                      )}
                    >
                      {verifState === "loading" ? "Vérification disponibilité…" : verifMsg}
                    </div>
                  ) : null}

                  {devis ? (
                    <p className="text-xs text-neutral-500">
                      Durée : {formatDureeLabel(selectedDuration)} · Prix :{" "}
                      {formatFcfa(devis.montant)} · Avance : {formatFcfa(devis.montant_avance)}
                    </p>
                  ) : null}
                </div>
              )}

              {step === 2 && (
                <div className="space-y-3">
                  <p className="rounded-xl bg-[var(--g-primary-glow)] px-3 py-2 text-xs text-[var(--g-primary)]">
                    {heureDebutEffective && heureFin
                      ? `${formatHourPill(heureDebutEffective)} - ${formatHourPill(heureFin)} · ${selectedDate}`
                      : ""}
                  </p>

                  <div>
                    <label htmlFor="joueur-tel" className="mb-1.5 block text-sm font-semibold text-[var(--g-text)]">
                      Numéro du joueur
                    </label>
                    <input
                      id="joueur-tel"
                      value={joueurTel}
                      onChange={(e) => {
                        setJoueurTel(formatPhoneDisplay(e.target.value));
                        setJoueurId(null);
                        setJoueurConnu(null);
                        if (lookupState === "connu") {
                          setJoueurPrenom("");
                          setJoueurNomFamille("");
                        }
                      }}
                      placeholder="7X XXX XX XX"
                      type="tel"
                      inputMode="numeric"
                      autoComplete="tel"
                      autoFocus
                      className={cn(
                        "h-12 w-full rounded-xl border bg-[var(--surface-2)] px-3 text-sm outline-none",
                        joueurTel.trim() && telError
                          ? "border-red-400 focus:border-red-500"
                          : "border-gray-200 focus:border-[var(--g-primary)]",
                      )}
                    />
                    {joueurTel.trim() && telError ? (
                      <p className="mt-1 text-[11px] font-medium text-red-600">{telError}</p>
                    ) : (
                      <p className="mt-1 text-[11px] text-neutral-400">Identifiant unique du joueur</p>
                    )}
                  </div>

                  {lookupState === "loading" && (
                    <p className="text-[11px] text-neutral-400">Recherche du joueur…</p>
                  )}

                  {lookupState === "connu" && joueurConnu && (
                    <div className="flex items-center gap-3 rounded-xl border border-[color-mix(in_srgb,var(--g-primary)_25%,white)] bg-[var(--g-primary-glow)] px-3 py-3">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--g-primary)] text-sm font-bold text-white">
                        {initialsFrom(joueurPrenom, joueurNomFamille, joueurConnu.display_nom)}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-[var(--g-text)]">{joueurConnu.display_nom}</p>
                        <p className="text-xs text-[var(--g-text-2)]">✓ {joueurConnu.display_nom} — joueur connu</p>
                      </div>
                    </div>
                  )}

                  {lookupState === "nouveau" && (
                    <div className="space-y-3">
                      <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                        Nouveau joueur — il recevra son accès par WhatsApp
                      </p>
                      <input
                        value={joueurPrenom}
                        onChange={(e) => setJoueurPrenom(e.target.value)}
                        placeholder="Prénom"
                        className="h-12 w-full rounded-xl border border-gray-200 bg-[var(--surface-2)] px-3 text-sm outline-none focus:border-[var(--g-primary)]"
                      />
                      <input
                        value={joueurNomFamille}
                        onChange={(e) => setJoueurNomFamille(e.target.value)}
                        placeholder="Nom"
                        className="h-12 w-full rounded-xl border border-gray-200 bg-[var(--surface-2)] px-3 text-sm outline-none focus:border-[var(--g-primary)]"
                      />
                    </div>
                  )}
                </div>
              )}

              {step === 3 && (
                <div className="space-y-4">
                  <p className="rounded-xl bg-[var(--g-primary-glow)] px-3 py-2 text-xs text-[var(--g-primary)]">
                    {displayNom}
                    {joueurTel ? ` · ${joueurTel}` : ""}
                    {selectedSlot && heureFin
                      ? ` · ${formatHourPill(selectedSlot)}-${formatHourPill(heureFin)}`
                      : ""}
                  </p>

                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
                      Type de terrain
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      {(
                        [
                          ["moitie", "Demi-terrain", terrainPrix.moitie],
                          ["entier", "Terrain entier", terrainPrix.entier],
                        ] as const
                      ).map(([value, label, price]) => {
                        const active = formatTerrain === value;
                        return (
                          <button
                            key={value}
                            type="button"
                            onClick={() => setFormatTerrain(value)}
                            className={cn(
                              "min-h-[64px] rounded-xl border p-3 text-left",
                              active
                                ? "border-[var(--g-primary)] bg-[var(--g-primary)] text-white"
                                : "border-gray-200 bg-white",
                            )}
                          >
                            <span className="block text-sm font-semibold">{label}</span>
                            <span className="text-[11px] opacity-80">
                              {price > 0 ? `${formatFcfa(price)}/h` : "—"}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {devis && (
                    <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm font-medium text-amber-900">
                      Avance : {formatFcfa(devis.montant_avance)} — Reste sur place :{" "}
                      {formatFcfa(devis.montant_restant)}
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-2 border-t border-gray-100 px-4 pt-3">
              {step === 1 && (
                <button
                  type="button"
                  disabled={!canGoStep2}
                  onClick={() => setStep(2)}
                  className="flex min-h-[48px] w-full items-center justify-center rounded-xl bg-[var(--g-primary)] text-sm font-semibold text-white disabled:opacity-50"
                >
                  Continuer
                </button>
              )}
              {step === 2 && (
                <button
                  type="button"
                  disabled={!canGoStep3}
                  onClick={() => setStep(3)}
                  className="flex min-h-[48px] w-full items-center justify-center rounded-xl bg-[var(--g-primary)] text-sm font-semibold text-white disabled:opacity-50"
                >
                  Continuer
                </button>
              )}
              {step === 3 && (
                <>
                  <p className="text-[13px] font-semibold" style={{ color: "var(--g-text)" }}>
                    Comment le joueur a payé ?
                  </p>
                  <button
                    type="button"
                    onClick={() => setPayChoice("lien")}
                    className="w-full rounded-xl px-3 py-3 text-left text-sm"
                    style={{
                      border: payChoice === "lien" ? "1.5px solid var(--g-primary)" : "1px solid var(--g-border, #e5e7eb)",
                      background: payChoice === "lien" ? "var(--g-primary-glow)" : "transparent",
                    }}
                  >
                    Envoyer le lien de paiement WhatsApp
                  </button>
                  <button
                    type="button"
                    onClick={() => setPayChoice("manuel")}
                    className="w-full rounded-xl px-3 py-3 text-left"
                    style={{
                      border: payChoice === "manuel" ? "1.5px solid var(--g-warning)" : "1px solid var(--g-border, #e5e7eb)",
                      background: payChoice === "manuel" ? "var(--g-warning-bg)" : "transparent",
                    }}
                  >
                    <span className="inline-flex items-center gap-2 text-sm font-semibold">
                      <AlertTriangle size={16} style={{ color: "var(--g-warning)" }} />
                      Le joueur a déjà payé directement
                    </span>
                    <p className="mt-1 text-[12px]" style={{ color: "var(--g-warning)" }}>
                      La commission de {formatFcfa(devis?.montant_commission || 0)} sera comptabilisée en dette.
                      Tu devras la régler en fin de mois.
                    </p>
                  </button>
                  {payChoice === "manuel" ? (
                    <textarea
                      value={noteManuel}
                      onChange={(e) => setNoteManuel(e.target.value)}
                      placeholder="Note (ex: Payé par Wave perso ce matin)"
                      className="w-full min-h-[72px] rounded-xl px-3 py-2 text-sm"
                      style={{ border: "1px solid var(--g-border, #e5e7eb)" }}
                    />
                  ) : null}
                  {payChoice === "lien" ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void submitPaiement()}
                      className="flex min-h-[48px] w-full items-center justify-center rounded-xl bg-[var(--g-primary)] text-sm font-semibold text-white disabled:opacity-50"
                    >
                      {busy ? "Envoi…" : "Envoyer le lien de paiement WhatsApp"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void submitManuel()}
                      className="flex min-h-[48px] w-full items-center justify-center rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                      style={{ background: "var(--g-warning)" }}
                    >
                      {busy ? "Confirmation…" : "Confirmer la réservation manuellement"}
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (!busy) onClose();
                    }}
                    className="flex min-h-[48px] w-full items-center justify-center rounded-xl border border-gray-300 text-sm font-semibold text-neutral-600 disabled:opacity-50"
                  >
                    Annuler
                  </button>
                  <p className="text-center text-[11px] text-neutral-400">
                    {payChoice === "lien"
                      ? "Le créneau reste libre jusqu'à confirmation du paiement"
                      : "Le créneau est verrouillé immédiatement après confirmation"}
                  </p>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
