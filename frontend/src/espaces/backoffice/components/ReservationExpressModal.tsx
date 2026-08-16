import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, Search, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { formatPhoneDisplay, phoneError, toLocal9 } from "@/auth/phone";
import { gerantApi, reservationsApi, terrainsApi } from "@/lib/api";
import { localYmd } from "@/lib/localDate";
import { cn, formatFcfa } from "@/lib/utils";

type JoueurHit = {
  id: number;
  display_nom: string;
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

function getEndTime(startSlot: string, duration: number) {
  const h = parseInt(startSlot.split(":")[0], 10) + duration;
  return `${String(h).padStart(2, "0")}:00`;
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

  const [step, setStep] = useState<Step>(1);
  const [selectedDateIdx, setSelectedDateIdx] = useState(0);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [selectedDuration, setSelectedDuration] = useState(1);
  const [formatTerrain, setFormatTerrain] = useState<"moitie" | "entier">("entier");
  const [creneaux, setCreneaux] = useState<Slot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [terrainPrix, setTerrainPrix] = useState<{ moitie: number; entier: number }>({
    moitie: 0,
    entier: 0,
  });

  const [q, setQ] = useState("");
  const [hits, setHits] = useState<JoueurHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [anonyme, setAnonyme] = useState(false);
  const [joueurId, setJoueurId] = useState<number | null>(null);
  const [joueurNom, setJoueurNom] = useState("");
  const [joueurTel, setJoueurTel] = useState("");
  const [devis, setDevis] = useState<{
    montant: number;
    montant_avance: number;
    montant_restant: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [waConnected, setWaConnected] = useState<boolean | null>(null);
  const [doneMsg, setDoneMsg] = useState<string | null>(null);

  const selectedDate = dates[selectedDateIdx]?.isoDate || localYmd();
  const heureFin = selectedSlot ? getEndTime(selectedSlot, selectedDuration) : null;

  const freeSlots = useMemo(
    () => creneaux.filter((s) => s.disponible !== false && s.statut !== "bloque"),
    [creneaux],
  );
  const noFreeToday =
    selectedDate === localYmd() && !loadingSlots && freeSlots.length === 0 && !lockedCreneau;

  useEffect(() => {
    if (!open) return;

    const iso = prefill?.date || localYmd();
    const idx = Math.max(0, dates.findIndex((d) => d.isoDate === iso));
    setStep(1);
    setSelectedDateIdx(idx >= 0 ? idx : 0);
    setSelectedSlot(prefill?.heure_debut ? formatHourLabel(prefill.heure_debut) : null);
    if (prefill?.heure_debut && prefill?.heure_fin) {
      const startH = parseInt(prefill.heure_debut, 10);
      const endH = parseInt(prefill.heure_fin, 10);
      const dur = Math.max(1, Math.min(3, endH - startH));
      setSelectedDuration(Number.isFinite(dur) ? dur : 1);
    } else {
      setSelectedDuration(1);
    }
    setFormatTerrain("entier");
    setQ("");
    setHits([]);
    setAnonyme(false);
    setJoueurId(null);
    setJoueurNom("");
    setJoueurTel("");
    setDevis(null);
    setBusy(false);
    setDoneMsg(null);
    gerantApi
      .whatsappStatus()
      .then((s: any) => setWaConnected(Boolean(s?.connected) && !s?.mock))
      .catch(() => setWaConnected(null));
  }, [open, prefill, dates]);

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
    terrainsApi
      .getCreneaux(terrainId, selectedDate)
      .then((data: any) => {
        if (cancelled) return;
        let slots: Slot[] = data?.creneaux || [];
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
  }, [open, terrainId, selectedDate]);

  useEffect(() => {
    if (!open || !q.trim() || anonyme) {
      setHits([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const t = window.setTimeout(() => {
      gerantApi
        .joueurs({ q: q.trim() })
        .then((data) => {
          if (!cancelled) setHits(((data as { joueurs?: JoueurHit[] })?.joueurs || []).slice(0, 6));
        })
        .catch(() => {
          if (!cancelled) setHits([]);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [q, open, anonyme]);

  useEffect(() => {
    if (!open || !selectedSlot || !heureFin) {
      setDevis(null);
      return;
    }
    let cancelled = false;
    const t = window.setTimeout(() => {
      gerantApi
        .getDevis({
          date: selectedDate,
          heure_debut: selectedSlot,
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
            });
            return;
          }
          const hourly = formatTerrain === "moitie" ? terrainPrix.moitie : terrainPrix.entier;
          const total = hourly * selectedDuration;
          const av = Math.round(total * 0.125);
          setDevis({ montant: total, montant_avance: av, montant_restant: Math.max(0, total - av) });
        })
        .catch(() => {
          if (cancelled) return;
          const hourly = formatTerrain === "moitie" ? terrainPrix.moitie : terrainPrix.entier;
          const total = hourly > 0 ? hourly * selectedDuration : 0;
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
    selectedSlot,
    heureFin,
    selectedDate,
    formatTerrain,
    selectedDuration,
    terrainPrix.moitie,
    terrainPrix.entier,
  ]);

  if (!open) return null;

  const pickJoueur = (j: JoueurHit) => {
    setJoueurId(j.id);
    setJoueurNom(j.display_nom);
    setJoueurTel(formatPhoneDisplay(String(j.telephone || "")));
    setQ(j.display_nom);
    setHits([]);
    setAnonyme(false);
  };

  const handleAnonyme = () => {
    setAnonyme(true);
    setJoueurId(null);
    setJoueurNom("Joueur de passage");
    setJoueurTel("");
    setQ("");
    setHits([]);
  };

  const canGoStep2 = Boolean(selectedSlot && heureFin);
  const canGoStep3 = Boolean(
    joueurNom.trim() && (anonyme || (joueurTel.trim() && !phoneError(joueurTel))),
  );

  const submit = async (mode: "bloquer" | "paiement") => {
    if (!terrainId) {
      toast.error("Terrain introuvable");
      return;
    }
    if (!selectedSlot || !heureFin) {
      toast.error("Choisis un créneau");
      return;
    }
    const nom = anonyme ? joueurNom.trim() || "Joueur de passage" : joueurNom.trim();
    if (!nom) {
      toast.error("Indique le nom du joueur");
      return;
    }
    if (mode === "paiement") {
      if (anonyme) {
        toast.error("Impossible d'envoyer un lien à un joueur anonyme");
        return;
      }
      const errPhone = phoneError(joueurTel);
      if (errPhone) {
        toast.error(errPhone);
        return;
      }
      if (waConnected === false) {
        const ok = window.confirm(
          "WhatsApp gérant non connecté : le lien ne sera peut‑être pas envoyé. Continuer ?",
        );
        if (!ok) return;
      }
    }

    setBusy(true);
    try {
      const result = (await reservationsApi.createGerant({
        terrain_id: terrainId,
        date: selectedDate,
        heure_debut: selectedSlot,
        heure_fin: heureFin,
        joueur_nom: nom,
        joueur_telephone: anonyme ? undefined : toLocal9(joueurTel),
        format_terrain: formatTerrain,
        joueur_id: joueurId || undefined,
        mode,
        anonyme,
      })) as {
        reservation_id?: number;
        whatsapp_sent?: boolean;
        whatsapp_error?: string | null;
        joueur_nom?: string;
        mode?: string;
      };

      onCreated?.();

      if (mode === "bloquer") {
        setDoneMsg("Créneau bloqué ✓");
        toast.success("Créneau bloqué ✓");
      } else {
        const prenom = String(result?.joueur_nom || nom).split(" ")[0];
        if (result?.whatsapp_sent) {
          setDoneMsg(`Lien envoyé à ${prenom} ✓`);
          toast.success(`Lien envoyé à ${prenom} ✓`);
        } else {
          setDoneMsg(`Réservation créée — lien à renvoyer`);
          toast.warning(
            result?.whatsapp_error
              ? `Créée (WhatsApp : ${result.whatsapp_error})`
              : "Créée — pense à renvoyer le lien",
          );
        }
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

        {/* Step indicators */}
        <div className="flex gap-1.5 px-4 pb-3">
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              className={cn("h-1 flex-1 rounded-full", n <= step ? "bg-emerald-600" : "bg-neutral-200")}
            />
          ))}
        </div>

        {doneMsg ? (
          <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
            <CheckCircle2 className="h-14 w-14 text-emerald-600" />
            <p className="text-lg font-bold text-[var(--text-primary)]">{doneMsg}</p>
          </div>
        ) : (
          <div className="flex flex-1 flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto px-4 pb-4">
              {/* ÉTAPE 1 — Créneau */}
              {step === 1 && (
                <div className="space-y-4">
                  {(noFreeToday || selectedDateIdx > 0 || lockedCreneau) && (
                    <div>
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
                        Date
                      </p>
                      <div className="scrollbar-none flex snap-x gap-2 overflow-x-auto">
                        {dates.map((d, i) => {
                          const active = selectedDateIdx === i;
                          return (
                            <button
                              key={d.isoDate}
                              type="button"
                              disabled={lockedCreneau && d.isoDate !== selectedDate}
                              onClick={() => {
                                setSelectedDateIdx(i);
                                if (!lockedCreneau) setSelectedSlot(null);
                              }}
                              className={cn(
                                "flex min-h-[70px] w-[58px] min-w-[58px] snap-start flex-col items-center justify-center rounded-xl py-2 text-[11px] font-medium",
                                active
                                  ? "bg-emerald-600 text-white shadow-sm"
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
                  )}

                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
                      Durée
                    </p>
                    <div className="flex gap-2">
                      {[1, 2, 3].map((h) => (
                        <button
                          key={h}
                          type="button"
                          disabled={lockedCreneau}
                          onClick={() => setSelectedDuration(h)}
                          className={cn(
                            "min-h-[44px] flex-1 rounded-xl text-sm font-semibold",
                            selectedDuration === h
                              ? "bg-emerald-600 text-white"
                              : "border border-gray-200 bg-white text-[var(--text-secondary)]",
                          )}
                        >
                          {h}h
                        </button>
                      ))}
                    </div>
                  </div>

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
                          const fin = getEndTime(heure, selectedDuration);
                          const selected = selectedSlot === heure;
                          return (
                            <button
                              key={heure}
                              type="button"
                              disabled={lockedCreneau && heure !== selectedSlot}
                              onClick={() => setSelectedSlot(heure)}
                              className={cn(
                                "min-h-[48px] rounded-xl border px-4 text-left text-sm font-semibold transition-colors",
                                selected
                                  ? "border-emerald-600 bg-emerald-600 text-white"
                                  : "border-gray-200 bg-white text-emerald-800",
                              )}
                            >
                              {formatHourPill(heure)} - {formatHourPill(fin)}
                              <span className={cn("ml-1 font-normal opacity-70", selected ? "text-white/80" : "")}>
                                · {selectedDuration}h
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {!noFreeToday && selectedDateIdx === 0 && !lockedCreneau ? (
                    <button
                      type="button"
                      onClick={() => setSelectedDateIdx(1)}
                      className="text-xs font-semibold text-emerald-600"
                    >
                      Voir une autre date →
                    </button>
                  ) : null}
                </div>
              )}

              {/* ÉTAPE 2 — Joueur */}
              {step === 2 && (
                <div className="space-y-3">
                  <p className="rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                    {selectedSlot && heureFin
                      ? `${formatHourPill(selectedSlot)} - ${formatHourPill(heureFin)} · ${selectedDate}`
                      : ""}
                  </p>

                  {!anonyme && (
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
                      <input
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        placeholder="Rechercher par téléphone ou nom"
                        className="h-12 w-full rounded-xl border border-gray-200 bg-[var(--surface-2)] pl-9 pr-3 text-sm outline-none focus:border-emerald-500"
                        autoFocus
                      />
                      {hits.length > 0 && (
                        <ul className="absolute left-0 right-0 z-10 mt-1 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-md">
                          {hits.map((j) => (
                            <li key={j.id}>
                              <button
                                type="button"
                                onClick={() => pickJoueur(j)}
                                className="min-h-[44px] w-full px-3 py-3 text-left text-sm"
                              >
                                {j.display_nom}
                                <span className="block text-xs text-neutral-400">{j.telephone || "—"}</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                      {searching && <p className="mt-1 text-[11px] text-neutral-400">Recherche…</p>}
                    </div>
                  )}

                  <input
                    value={joueurNom}
                    onChange={(e) => {
                      setJoueurNom(e.target.value);
                      if (joueurId) setJoueurId(null);
                    }}
                    placeholder="Nom du joueur"
                    className="h-12 w-full rounded-xl border border-gray-200 bg-[var(--surface-2)] px-3 text-sm outline-none focus:border-emerald-500"
                  />
                  {!anonyme && (
                    <input
                      value={joueurTel}
                      onChange={(e) => {
                        setJoueurTel(formatPhoneDisplay(e.target.value));
                        if (joueurId) setJoueurId(null);
                      }}
                      placeholder="77 000 00 00"
                      type="tel"
                      className="h-12 w-full rounded-xl border border-gray-200 bg-[var(--surface-2)] px-3 text-sm outline-none focus:border-emerald-500"
                    />
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      if (anonyme) {
                        setAnonyme(false);
                        setJoueurNom("");
                      } else {
                        handleAnonyme();
                      }
                    }}
                    className="min-h-[44px] text-xs font-semibold text-emerald-600"
                  >
                    {anonyme ? "Chercher un joueur connu" : "Joueur anonyme (pas de WhatsApp)"}
                  </button>
                </div>
              )}

              {/* ÉTAPE 3 — Type + actions */}
              {step === 3 && (
                <div className="space-y-4">
                  <p className="rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                    {joueurNom}
                    {!anonyme && joueurTel ? ` · ${joueurTel}` : " · Anonyme"}
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
                                ? "border-emerald-600 bg-emerald-600 text-white"
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

            <div className="border-t border-gray-100 px-4 pt-3 space-y-2">
              {step === 1 && (
                <button
                  type="button"
                  disabled={!canGoStep2}
                  onClick={() => setStep(2)}
                  className="flex min-h-[48px] w-full items-center justify-center rounded-xl bg-emerald-600 text-sm font-semibold text-white disabled:opacity-50"
                >
                  Continuer
                </button>
              )}
              {step === 2 && (
                <button
                  type="button"
                  disabled={!canGoStep3}
                  onClick={() => setStep(3)}
                  className="flex min-h-[48px] w-full items-center justify-center rounded-xl bg-emerald-600 text-sm font-semibold text-white disabled:opacity-50"
                >
                  Continuer
                </button>
              )}
              {step === 3 && (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void submit("bloquer")}
                    className="flex min-h-[48px] w-full items-center justify-center rounded-xl border-2 border-emerald-600 text-sm font-semibold text-emerald-700 disabled:opacity-50"
                  >
                    {busy ? "…" : "Bloquer le créneau"}
                  </button>
                  <button
                    type="button"
                    disabled={busy || anonyme}
                    onClick={() => void submit("paiement")}
                    className="flex min-h-[48px] w-full items-center justify-center rounded-xl bg-emerald-600 text-sm font-semibold text-white disabled:opacity-50"
                    title={anonyme ? "Indisponible pour un joueur anonyme" : undefined}
                  >
                    {busy ? "Envoi…" : "Envoyer le lien de paiement"}
                  </button>
                  {anonyme ? (
                    <p className="text-center text-[11px] text-neutral-400">
                      Lien de paiement désactivé pour un joueur anonyme
                    </p>
                  ) : (
                    <p className="text-center text-[11px] text-neutral-400">
                      Verrou 2 h si non payé — le créneau se libère automatiquement
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
