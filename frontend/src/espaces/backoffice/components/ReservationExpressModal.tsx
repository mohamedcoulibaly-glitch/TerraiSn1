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
import { featureEnabled } from "@/lib/terrainFeatures";

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

const DUREES_EXPRESS_FALLBACK = [
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
  const [formatTerrain, setFormatTerrain] = useState<string>("moitie");
  const [formatsOpts, setFormatsOpts] = useState<
    { cle: string; label: string; prix_heure: number; map_grille?: string | null }[]
  >([
    { cle: "moitie", label: "Demi-terrain", prix_heure: 0, map_grille: "demi" },
    { cle: "entier", label: "Terrain entier", prix_heure: 0, map_grille: "entier" },
  ]);
  const [dureesOpts, setDureesOpts] = useState<{ label: string; hours: number }[]>([
    ...DUREES_EXPRESS_FALLBACK,
  ]);
  const [creneaux, setCreneaux] = useState<Slot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [terrainPrix, setTerrainPrix] = useState<{ moitie: number; entier: number }>({
    moitie: 0,
    entier: 0,
  });
  const [politiquePaiement, setPolitiquePaiement] = useState<"avance" | "sans_avance">("avance");
  const [features, setFeatures] = useState<Record<string, boolean>>({});
  const [pourcentageAvance, setPourcentageAvance] = useState(12.5);
  const [commissionPourcentage, setCommissionPourcentage] = useState(8);
  const sansAvance = politiquePaiement === "sans_avance";
  const canConfirmManual = featureEnabled(features, "confirmations_manuelles", true);

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
    pourcentage_avance?: number | null;
    commission_pourcentage?: number | null;
    nom_tarif?: string | null;
  } | null>(null);
  const [payChoice, setPayChoice] = useState<"lien" | "manuel">("lien");
  const [noteManuel, setNoteManuel] = useState("");
  const [busy, setBusy] = useState(false);
  const [waConnected, setWaConnected] = useState<boolean | null>(null);
  const [waGateOpen, setWaGateOpen] = useState(false);
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
      const match = dureesOpts.find((d) => Math.abs(d.hours - durH) < 0.01);
      setSelectedDuration(match ? match.hours : Math.min(3, Math.max(1, Math.round(durH))));
    } else {
      setSelectedDuration(1);
    }
    setFormatTerrain("moitie");
    setJoueurTel("");
    setJoueurPrenom("");
    setJoueurNomFamille("");
    setJoueurId(null);
    setJoueurConnu(null);
    setLookupState("idle");
    setDevis(null);
    setPayChoice("lien");
    setNoteManuel("");
    setBusy(false);
    setDoneMsg(null);
    setWaGateOpen(false);
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
        setPolitiquePaiement(
          ["sans_avance", "sans_acompte"].includes(String(t?.politique_paiement || "").trim())
            ? "sans_avance"
            : "avance",
        );
        setFeatures((t?.features && typeof t.features === "object" ? t.features : {}) as Record<string, boolean>);
        const pctAvance = Number(t?.pourcentage_avance);
        setPourcentageAvance(Number.isFinite(pctAvance) && pctAvance > 0 ? pctAvance : 12.5);
        const pctComm = Number(t?.commission_pourcentage);
        setCommissionPourcentage(Number.isFinite(pctComm) && pctComm > 0 ? pctComm : 8);
        const formats =
          Array.isArray(t?.formats) && t.formats.length
            ? t.formats.map((f: any) => ({
                cle: String(f.cle),
                label: String(f.label || f.cle),
                prix_heure: Number(f.prix_heure || 0),
                map_grille: f.map_grille || null,
              }))
            : [
                { cle: "moitie", label: "Demi-terrain", prix_heure: Number(t?.prix_moitie || 0), map_grille: "demi" },
                {
                  cle: "entier",
                  label: "Terrain entier",
                  prix_heure: Number(t?.prix_entier || t?.prix_heure || 0),
                  map_grille: "entier",
                },
              ];
        setFormatsOpts(formats);
        const preferred = formats.find((f: any) => f.cle === "moitie") || formats[0];
        if (preferred) setFormatTerrain(preferred.cle);
        const durees =
          Array.isArray(t?.durees) && t.durees.length
            ? t.durees.map((d: any) => ({
                label: String(d.label || `${d.minutes} min`),
                hours: Number(d.minutes) / 60,
              }))
            : [...DUREES_EXPRESS_FALLBACK];
        setDureesOpts(durees);
        if (!prefill?.heure_debut) {
          const d1 = durees.find((d: any) => Math.abs(d.hours - 1) < 0.01) || durees[0];
          if (d1) setSelectedDuration(d1.hours);
        }
      })
      .catch(() => {
        setTerrainPrix({ moitie: 0, entier: 0 });
        setPolitiquePaiement("avance");
        setFeatures({});
      });
  }, [open, terrainId, prefill?.heure_debut]);

  useEffect(() => {
    if (!open) return;
    if (sansAvance) setPayChoice("manuel");
  }, [open, sansAvance]);

  useEffect(() => {
    if (!open || !terrainId || !selectedDate) return;
    let cancelled = false;
    setLoadingSlots(true);
    const dureeMin = Math.round(selectedDuration * 60);
    gerantApi
      .disponibilites(selectedDate, { duree_minutes: dureeMin })
      .then((data: any) => {
        if (cancelled) return;
        let slots: Slot[] = (data?.creneaux || []).map((s: any) => ({
          heure: s.heure || s.heure_debut,
          heure_fin: s.heure_fin,
          disponible: s.disponible,
          statut: s.statut,
        }));
        // Express : ne pas proposer un départ déjà passé (aujourd'hui)
        const today = localYmd();
        if (selectedDate === today) {
          const now = new Date();
          const nowMin = now.getHours() * 60 + now.getMinutes();
          slots = slots.filter((s) => {
            const [h, m] = String(s.heure || "").slice(0, 5).split(":").map(Number);
            if (!Number.isFinite(h)) return true;
            return h * 60 + (m || 0) > nowMin;
          });
        }
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

    const buildLocalDevis = (total: number) => {
      if (!(total > 0)) return null;
      const avance = Math.min(total, Math.round((total * pourcentageAvance) / 100));
      const commission = Math.min(avance, Math.round((avance * commissionPourcentage) / 100));
      return {
        montant: total,
        montant_avance: avance,
        montant_restant: Math.max(0, total - avance),
        montant_commission: commission,
        pourcentage_avance: pourcentageAvance,
        commission_pourcentage: commissionPourcentage,
      };
    };

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
          const commission = Number(payload?.montant_commission);
          if (Number.isFinite(montant) && montant > 0 && Number.isFinite(avance)) {
            const avanceOk = avance >= 0 ? avance : Math.min(montant, Math.round((montant * pourcentageAvance) / 100));
            const commissionOk = Number.isFinite(commission)
              ? commission
              : Math.min(avanceOk, Math.round((avanceOk * commissionPourcentage) / 100));
            setDevis({
              montant,
              montant_avance: avanceOk,
              montant_restant: Number.isFinite(restant) ? restant : Math.max(0, montant - avanceOk),
              montant_commission: commissionOk,
              pourcentage_avance:
                payload?.pourcentage_avance != null
                  ? Number(payload.pourcentage_avance)
                  : pourcentageAvance,
              commission_pourcentage:
                payload?.commission_pourcentage != null
                  ? Number(payload.commission_pourcentage)
                  : commissionPourcentage,
              nom_tarif: payload?.detail?.[0]?.nom_tarif || null,
            });
            return;
          }
          const fmt = formatsOpts.find((f) => f.cle === formatTerrain);
          const hourly =
            formatTerrain === "moitie"
              ? terrainPrix.moitie
              : formatTerrain === "entier"
                ? terrainPrix.entier
                : Number(fmt?.prix_heure || terrainPrix.entier || 0);
          setDevis(buildLocalDevis(Math.round(hourly * selectedDuration)));
        })
        .catch(() => {
          if (cancelled) return;
          const fmt = formatsOpts.find((f) => f.cle === formatTerrain);
          const hourly =
            formatTerrain === "moitie"
              ? terrainPrix.moitie
              : formatTerrain === "entier"
                ? terrainPrix.entier
                : Number(fmt?.prix_heure || terrainPrix.entier || 0);
          const total = hourly > 0 ? Math.round(hourly * selectedDuration) : 0;
          setDevis(buildLocalDevis(total));
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
    formatsOpts,
    pourcentageAvance,
    commissionPourcentage,
  ]);

  if (!open) return null;

  const canGoStep2 = Boolean(heureDebutEffective && heureFin && verifState !== "conflit");
  const canGoStep3 = Boolean(!telError && displayNom);

  const requireWhatsAppOrGate = () => {
    if (waDown || waConnected === false) {
      setWaGateOpen(true);
      return false;
    }
    return true;
  };

  const goToWhatsAppPairing = () => {
    onClose();
    navigate("/backoffice/gerant/parametres?section=whatsapp");
  };

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
    if (!requireWhatsAppOrGate()) return;

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
    if (!sansAvance && !canConfirmManual) {
      toast.error("Les confirmations manuelles sont désactivées pour ce terrain");
      return;
    }
    if (!requireWhatsAppOrGate()) return;
    setBusy(true);
    try {
      if (sansAvance) {
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
          mode: "bloquer",
        })) as { reservation_id?: number };
        if (!created?.reservation_id) throw new Error("Réservation non créée");
        onCreated?.();
        setDoneMsg("Réservation confirmée ✓ — paiement sur place");
        toast.success("Réservation confirmée — total à encaisser sur place");
        window.setTimeout(() => {
          onClose();
          navigate(`/backoffice/gerant/reservations/${created.reservation_id}`);
        }, 900);
        return;
      }
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
              <h2 className="text-base font-bold text-[var(--text-primary)]">Réserver</h2>
            </div>
            <p className="mt-0.5 text-xs text-neutral-400">
              Étape {step}/3
              {step === 1 && " — Créneau"}
              {step === 2 && " — Joueur"}
              {step === 3 && " — Paiement"}
            </p>
            {waConnected === false && step === 3 && !waGateOpen ? (
              <p className="mt-1 text-[11px] font-medium text-amber-600">
                WhatsApp non connecté — tu seras invité à l&apos;appairer avant validation.
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
        ) : waGateOpen ? (
          <div className="flex flex-1 flex-col px-4 pb-6 pt-2">
            <div
              className="rounded-2xl border px-4 py-5 space-y-3"
              style={{
                borderColor: "color-mix(in srgb, #f59e0b 40%, transparent)",
                background: "color-mix(in srgb, #f59e0b 10%, white)",
              }}
            >
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600 mt-0.5" />
                <div>
                  <p className="text-sm font-bold" style={{ color: "var(--g-text)" }}>
                    WhatsApp déconnecté
                  </p>
                  <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--g-muted)" }}>
                    {waDown
                      ? WHATSAPP_INFRA_MESSAGE
                      : "Connecte ton WhatsApp pour finaliser la réservation et notifier le joueur."}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={goToWhatsAppPairing}
                className="flex min-h-[48px] w-full items-center justify-center rounded-xl text-sm font-semibold text-white"
                style={{ background: "var(--g-primary)" }}
              >
                Connecter WhatsApp
              </button>
              <button
                type="button"
                onClick={() => setWaGateOpen(false)}
                className="flex min-h-[40px] w-full items-center justify-center rounded-xl text-sm font-medium"
                style={{ color: "var(--g-muted)", border: "1px solid var(--g-border, #e5e7eb)" }}
              >
                Retour
              </button>
            </div>
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
                      {dureesOpts.map((d) => (
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
                    {selectedDuration !== 1 ? (
                      <p className="mt-2 text-[11px] text-amber-700">
                        Durée ≠ 1 h (habituel) — vérifie avant de continuer.
                      </p>
                    ) : null}
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
                      {formatFcfa(devis.montant)}
                      {sansAvance
                        ? " · Paiement sur place (sans avance)"
                        : ` · Avance : ${formatFcfa(devis.montant_avance)}`}
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
                      {formatsOpts.map((fmt) => {
                        const active = formatTerrain === fmt.cle;
                        return (
                          <button
                            key={fmt.cle}
                            type="button"
                            onClick={() => setFormatTerrain(fmt.cle)}
                            className={cn(
                              "min-h-[64px] rounded-xl border p-3 text-left",
                              active
                                ? "border-[var(--g-primary)] bg-[var(--g-primary)] text-white"
                                : "border-gray-200 bg-white",
                            )}
                          >
                            <span className="block text-sm font-semibold">{fmt.label}</span>
                            <span className="text-[11px] opacity-80">
                              {active && devis
                                ? `Total créneau : ${formatFcfa(devis.montant)}`
                                : "Prix selon créneau / grille"}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    {formatTerrain !== "moitie" ? (
                      <p className="mt-2 text-[11px] text-amber-700">
                        Format sélectionné :{" "}
                        {formatsOpts.find((f) => f.cle === formatTerrain)?.label || formatTerrain}
                      </p>
                    ) : null}
                    {devis?.nom_tarif ? (
                      <p className="mt-1 text-[11px] text-neutral-500">
                        Tarif appliqué : {devis.nom_tarif}
                      </p>
                    ) : null}
                  </div>

                  {devis && (
                    <div className="rounded-xl border-2 border-[var(--g-primary)] bg-[var(--g-primary-glow)] px-3 py-3 space-y-1">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--g-primary)]">
                        Prix à confirmer
                      </p>
                      <p
                        className="text-xl font-bold"
                        style={{ color: "var(--g-text)", fontFamily: "var(--font-display)" }}
                      >
                        {formatFcfa(devis.montant)}
                      </p>
                      <p className="text-xs text-amber-900">
                        {sansAvance
                          ? `Sans avance — total à encaisser sur place : ${formatFcfa(devis.montant)}`
                          : `Avance (${devis.pourcentage_avance ?? pourcentageAvance}%) : ${formatFcfa(devis.montant_avance)} — Reste sur place : ${formatFcfa(devis.montant_restant)}`}
                      </p>
                      {!sansAvance && Number(devis.montant_commission || 0) > 0 ? (
                        <p className="text-[11px] text-neutral-600">
                          Commission plateforme ({devis.commission_pourcentage ?? commissionPourcentage}% de
                          l&apos;avance) : {formatFcfa(devis.montant_commission || 0)}
                        </p>
                      ) : null}
                    </div>
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
                  {devis ? (
                    <div className="rounded-xl bg-[var(--g-primary-glow)] px-3 py-2 text-center">
                      <p className="text-[11px] font-semibold text-[var(--g-primary)]">Total</p>
                      <p className="text-lg font-bold" style={{ color: "var(--g-text)" }}>
                        {formatFcfa(devis.montant)}
                      </p>
                    </div>
                  ) : null}
                  <p className="text-[13px] font-semibold" style={{ color: "var(--g-text)" }}>
                    {sansAvance ? "Confirmer la réservation" : "Comment le joueur a payé ?"}
                  </p>
                  {sansAvance ? (
                    <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                      Politique sans avance : le match est confirmé tout de suite, le total se paie sur place.
                    </p>
                  ) : null}
                  {!sansAvance ? (
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
                  ) : null}
                  {(sansAvance || canConfirmManual) ? (
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
                        {sansAvance
                          ? "Confirmer — paiement sur place"
                          : "Le joueur a déjà payé directement"}
                      </span>
                      {!sansAvance ? (
                        <p className="mt-1 text-[12px]" style={{ color: "var(--g-warning)" }}>
                          La commission de{" "}
                          {formatFcfa(
                            devis?.montant_commission ??
                              Math.min(
                                Number(devis?.montant_avance || 0),
                                Math.round(
                                  (Number(devis?.montant_avance || 0) * commissionPourcentage) / 100,
                                ),
                              ),
                          )}{" "}
                          ({commissionPourcentage}% de l&apos;avance) sera comptabilisée en dette. Tu
                          devras la régler en fin de mois.
                        </p>
                      ) : null}
                    </button>
                  ) : null}
                  {payChoice === "manuel" && !sansAvance ? (
                    <textarea
                      value={noteManuel}
                      onChange={(e) => setNoteManuel(e.target.value)}
                      placeholder="Note (ex: Payé par Wave perso ce matin)"
                      className="w-full min-h-[72px] rounded-xl px-3 py-2 text-sm"
                      style={{ border: "1px solid var(--g-border, #e5e7eb)" }}
                    />
                  ) : null}
                  {payChoice === "lien" && !sansAvance ? (
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
                      disabled={busy || (!sansAvance && !canConfirmManual)}
                      onClick={() => void submitManuel()}
                      className="flex min-h-[48px] w-full items-center justify-center rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                      style={{ background: "var(--g-warning)" }}
                    >
                      {busy
                        ? "Confirmation…"
                        : sansAvance
                          ? "Confirmer la réservation"
                          : "Confirmer la réservation manuellement"}
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
                    {sansAvance
                      ? "Le créneau est verrouillé immédiatement"
                      : payChoice === "lien"
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
