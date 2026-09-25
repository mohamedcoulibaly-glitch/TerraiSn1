import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Check, CloudRain, DoorClosed, MoreHorizontal, Repeat, Trophy, Wrench, X } from "lucide-react";
import { toast } from "sonner";
import { gerantApi } from "@/lib/api";
import { localYmd } from "@/lib/localDate";
import { cn } from "@/lib/utils";
import { ConfirmationModal } from "@/espaces/backoffice/components/ConfirmationModal";
import { featureEnabled } from "@/lib/terrainFeatures";
import { clearDraft, readDraft, writeDraft } from "@/hooks/usePersistedState";

type Blocage = {
  id: number;
  date: string;
  heure_debut: string;
  heure_fin: string;
  motif?: string | null;
  type_blocage?: string | null;
  libelle?: string | null;
  groupe_id?: string | null;
};

type Groupe = {
  id: string;
  type_blocage: string;
  libelle?: string | null;
  date_debut?: string;
  date_fin?: string;
  jours?: string | null;
  heure_debut?: string;
  heure_fin?: string;
  montant?: number | null;
  montant_contrat?: number | null;
  montant_encaisse?: number | null;
  reste_a_encaisser?: number | null;
  nb_creneaux?: number;
};

type FreeSlot = {
  heure_debut: string;
  heure_fin: string;
};

type Mode = "manuel" | "abonnement" | "tournoi";

type BlocageDraft = {
  mode: Mode;
  date: string;
  motif: string | null;
  selected: string[];
  libelle: string;
  dateDebut: string;
  dateFin: string;
  heureDebut: string;
  heureFin: string;
  joursAbo: string[];
  joursTournoi: string[];
  montant: string;
};

function blocageDraftKey(terrainId?: number) {
  return `gerant:blocage:${terrainId || "x"}`;
}

type Props = {
  open: boolean;
  onClose: () => void;
  terrainId?: number;
  blocages?: Blocage[];
  onChanged?: () => void;
  /** Feature flags terrain (dashboard gérant). */
  features?: Record<string, boolean> | null;
};

const MOTIFS = [
  { value: "pluie", label: "Pluie", Icon: CloudRain },
  { value: "maintenance", label: "Maintenance", Icon: Wrench },
  { value: "fermeture", label: "Fermeture", Icon: DoorClosed },
  { value: "autre", label: "Autre", Icon: MoreHorizontal },
] as const;

const MOTIF_LABEL: Record<string, string> = {
  pluie: "Pluie",
  maintenance: "Maintenance",
  fermeture: "Fermeture",
  match_prive: "Match privé",
  autre: "Autre",
};

const JOURS_ABO = [
  { id: "lundi", label: "Lun" },
  { id: "mardi", label: "Mar" },
  { id: "mercredi", label: "Mer" },
  { id: "jeudi", label: "Jeu" },
  { id: "vendredi", label: "Ven" },
  { id: "samedi", label: "Sam" },
  { id: "dimanche", label: "Dim" },
] as const;

function formatPill(debut: string, fin: string) {
  const d = String(debut).slice(0, 5).replace(":", "h");
  const f = String(fin).slice(0, 5).replace(":", "h");
  return `${d} - ${f}`;
}

function slotKey(s: { heure_debut: string; heure_fin: string }) {
  return `${String(s.heure_debut).slice(0, 5)}|${String(s.heure_fin).slice(0, 5)}`;
}

function formatFcfa(n?: number | null) {
  if (n == null || Number(n) <= 0) return null;
  return `${Number(n).toLocaleString("fr-FR")} FCFA`;
}

function typeLabel(type?: string | null) {
  if (type === "ABONNEMENT") return "Abonnement";
  if (type === "TOURNOI") return "Tournoi";
  return "Manuel";
}

async function loadFreeSlots(terrainId: number, date: string): Promise<FreeSlot[]> {
  const data = (await gerantApi.disponibilites(date)) as any;
  return (data?.creneaux || [])
    .filter((c: any) => c.disponible !== false && c.statut !== "occupe" && c.statut !== "bloque" && c.statut !== "reserve")
    .map((c: any) => {
      const debut = String(c.heure_debut || c.heure || "").slice(0, 5);
      const fin =
        String(c.heure_fin || "").slice(0, 5) ||
        (() => {
          const h = parseInt(debut.split(":")[0], 10);
          return `${String(h + 1).padStart(2, "0")}:00`;
        })();
      return { heure_debut: debut, heure_fin: fin };
    })
    .filter((c: FreeSlot) => c.heure_debut && c.heure_fin);
}

export default function BloquerCreneauModal({
  open,
  onClose,
  terrainId,
  blocages = [],
  onChanged,
  features,
}: Props) {
  const allowAbonnement = featureEnabled(features, "abonnements", false);
  const allowTournoi = featureEnabled(features, "tournois", true);
  const [mode, setMode] = useState<Mode>("manuel");
  const [date, setDate] = useState(localYmd());
  const [motif, setMotif] = useState<(typeof MOTIFS)[number]["value"] | null>("pluie");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [freeSlots, setFreeSlots] = useState<FreeSlot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showList, setShowList] = useState(false);
  const [localBlocages, setLocalBlocages] = useState<Blocage[]>(blocages);

  useEffect(() => {
    if (mode === "abonnement" && !allowAbonnement) setMode("manuel");
    if (mode === "tournoi" && !allowTournoi) setMode("manuel");
  }, [mode, allowAbonnement, allowTournoi]);
  const [groupes, setGroupes] = useState<Groupe[]>([]);
  const [confirmBlock, setConfirmBlock] = useState(false);

  const [libelle, setLibelle] = useState("");
  const [dateDebut, setDateDebut] = useState(localYmd());
  const [dateFin, setDateFin] = useState(localYmd());
  const [heureDebut, setHeureDebut] = useState("08:00");
  const [heureFin, setHeureFin] = useState("12:00");
  const [joursAbo, setJoursAbo] = useState<Set<string>>(
    new Set(["lundi", "mardi", "mercredi", "jeudi", "vendredi"]),
  );
  const [joursTournoi, setJoursTournoi] = useState<Set<string>>(new Set(["samedi", "dimanche"]));
  const [montant, setMontant] = useState("");

  useEffect(() => {
    if (!open) return;
    const draft = readDraft<BlocageDraft>(blocageDraftKey(terrainId));
    if (draft) {
      setMode(draft.mode || "manuel");
      setDate(draft.date || localYmd());
      setMotif((draft.motif as (typeof MOTIFS)[number]["value"]) || "pluie");
      setSelected(new Set(draft.selected || []));
      setLibelle(draft.libelle || "");
      setDateDebut(draft.dateDebut || localYmd());
      setDateFin(draft.dateFin || localYmd());
      setHeureDebut(draft.heureDebut || "08:00");
      setHeureFin(draft.heureFin || "12:00");
      setJoursAbo(
        new Set(
          draft.joursAbo?.length
            ? draft.joursAbo
            : ["lundi", "mardi", "mercredi", "jeudi", "vendredi"],
        ),
      );
      setJoursTournoi(
        new Set(draft.joursTournoi?.length ? draft.joursTournoi : ["samedi", "dimanche"]),
      );
      setMontant(draft.montant || "");
    } else {
      setMode("manuel");
      setDate(localYmd());
      setMotif("pluie");
      setSelected(new Set());
      setLibelle("");
      setDateDebut(localYmd());
      setDateFin(localYmd());
      setHeureDebut("08:00");
      setHeureFin("12:00");
      setJoursAbo(new Set(["lundi", "mardi", "mercredi", "jeudi", "vendredi"]));
      setJoursTournoi(new Set(["samedi", "dimanche"]));
      setMontant("");
    }
    setShowList(false);
    setLocalBlocages(blocages);
    setBusy(false);
    setConfirmBlock(false);
    gerantApi
      .listBlocageGroupes()
      .then((data: any) => setGroupes(data?.groupes || []))
      .catch(() => setGroupes([]));
  }, [open, terrainId]);

  useEffect(() => {
    if (!open || busy) return;
    writeDraft(blocageDraftKey(terrainId), {
      mode,
      date,
      motif,
      selected: [...selected],
      libelle,
      dateDebut,
      dateFin,
      heureDebut,
      heureFin,
      joursAbo: [...joursAbo],
      joursTournoi: [...joursTournoi],
      montant,
    } satisfies BlocageDraft);
  }, [
    open,
    busy,
    terrainId,
    mode,
    date,
    motif,
    selected,
    libelle,
    dateDebut,
    dateFin,
    heureDebut,
    heureFin,
    joursAbo,
    joursTournoi,
    montant,
  ]);

  const slotsDate = date;

  useEffect(() => {
    if (!open || !terrainId || !slotsDate || mode !== "manuel") {
      return;
    }
    let cancelled = false;
    setLoadingSlots(true);
    loadFreeSlots(terrainId, slotsDate)
      .then((slots) => {
        if (!cancelled) setFreeSlots(slots);
      })
      .catch(() => {
        if (!cancelled) setFreeSlots([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingSlots(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, terrainId, slotsDate, mode]);

  const dayBlocages = useMemo(
    () => localBlocages.filter((b) => String(b.date).slice(0, 10) === date),
    [localBlocages, date],
  );

  if (!open) return null;

  const toggleSlot = (slot: FreeSlot) => {
    const key = slotKey(slot);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const refreshAfterChange = async () => {
    onChanged?.();
    if (terrainId && mode === "manuel") {
      try {
        setFreeSlots(await loadFreeSlots(terrainId, slotsDate));
      } catch {
        setFreeSlots([]);
      }
    }
    try {
      const data = (await gerantApi.listBlocageGroupes()) as { groupes?: Groupe[] };
      setGroupes(data?.groupes || []);
    } catch {
      /* ignore */
    }
  };

  const handleBlock = async () => {
    setBusy(true);
    try {
      if (mode === "abonnement") {
        if (!libelle.trim()) {
          toast.error("Indique le nom du club ou de l’abonnement");
          return;
        }
        if (joursAbo.size === 0) {
          toast.error("Sélectionne au moins un jour");
          return;
        }
        const result = (await gerantApi.addBlocageAbonnement({
          libelle: libelle.trim(),
          date_debut: dateDebut,
          date_fin: dateFin,
          heure_debut: heureDebut,
          heure_fin: heureFin,
          jours: [...joursAbo],
          montant_mensuel_abonnement: Number(montant) > 0 ? Number(montant) : 0,
        })) as { count?: number; message?: string; skipped?: number };
        toast.success(result?.message || `${result?.count || 0} créneau(x) bloqué(s) ✓`);
        if (result?.skipped) toast.message(`${result.skipped} créneau(x) déjà pris ignoré(s)`);
      } else if (mode === "tournoi") {
        if (!libelle.trim()) {
          toast.error("Indique le nom du tournoi");
          return;
        }
        if (joursTournoi.size === 0) {
          toast.error("Sélectionne au moins un jour");
          return;
        }
        const result = (await gerantApi.addBlocageTournoi({
          libelle: libelle.trim(),
          date_debut: dateDebut,
          date_fin: dateFin,
          heure_debut: heureDebut,
          heure_fin: heureFin,
          jours: [...joursTournoi],
          montant_tournoi: Number(montant) > 0 ? Number(montant) : 0,
        })) as { count?: number; message?: string; skipped?: number };
        toast.success(result?.message || `${result?.count || 0} créneau(x) bloqué(s) ✓`);
        if (result?.skipped) toast.message(`${result.skipped} créneau(x) déjà pris ignoré(s)`);
      } else {
        if (selected.size === 0) {
          toast.error("Sélectionne au moins un créneau");
          return;
        }
        const creneaux = freeSlots.filter((s) => selected.has(slotKey(s)));
        const result = (await gerantApi.addBlocagesBatch({
          date,
          motif: motif || null,
          creneaux,
        })) as { count?: number; blocages?: Blocage[]; message?: string };
        if (result?.blocages?.length) {
          setLocalBlocages((prev) => [...result.blocages!, ...prev]);
        }
        setSelected(new Set());
        toast.success(result?.message || `${result?.count || creneaux.length} créneau(x) bloqué(s) ✓`);
      }
      await refreshAfterChange();
      clearDraft(blocageDraftKey(terrainId));
    } catch (err: any) {
      toast.error(err?.message || "Blocage impossible");
    } finally {
      setBusy(false);
    }
  };

  const handleUnblock = async (id: number) => {
    try {
      await gerantApi.removeBlocage(id);
      setLocalBlocages((prev) => prev.filter((b) => b.id !== id));
      toast.success("Créneau débloqué");
      await refreshAfterChange();
    } catch (err: any) {
      toast.error(err?.message || "Déblocage impossible");
    }
  };

  const handleUnblockGroupe = async (id: string) => {
    try {
      const result = (await gerantApi.removeBlocageGroupe(id)) as { count?: number };
      toast.success(`${result?.count || 0} créneau(x) débloqué(s)`);
      setGroupes((prev) => prev.filter((g) => g.id !== id));
      await refreshAfterChange();
    } catch (err: any) {
      toast.error(err?.message || "Déblocage impossible");
    }
  };

  const confirmTexte =
    mode === "abonnement"
      ? "Tous les créneaux de cette récurrence seront bloqués et indisponibles à la réservation publique."
      : mode === "tournoi"
        ? "Les horaires seront bloqués uniquement les jours sélectionnés, sur toute la durée du tournoi."
        : "Ce créneau ne sera plus visible sur l'app joueur.\nTu pourras le débloquer à tout moment.";

  const canSubmit =
    mode === "abonnement"
      ? Boolean(libelle.trim() && dateDebut && dateFin && heureDebut && heureFin && joursAbo.size)
      : mode === "tournoi"
        ? Boolean(libelle.trim() && dateDebut && dateFin && heureDebut && heureFin && joursTournoi.size)
        : selected.size > 0;

  return (
    <div className="gerant-app fixed inset-0 z-[60] flex items-end md:items-center justify-center">
      <button type="button" className="absolute inset-0 bg-black/40" aria-label="Fermer" onClick={onClose} />
      <div
        className="relative w-full max-w-lg rounded-t-2xl md:rounded-2xl max-h-[92vh] overflow-y-auto pb-safe"
        style={{ background: "var(--g-surface)", boxShadow: "var(--g-shadow-md)" }}
      >
        <div className="flex justify-center pt-3 pb-1">
          <span className="w-10 h-1 rounded-full" style={{ background: "var(--g-border)" }} />
        </div>
        <div className="flex items-start justify-between px-4 pb-3">
          <div>
            <h2 className="text-base font-bold" style={{ color: "var(--g-text)" }}>
              Événements
            </h2>
            <p className="text-xs mt-0.5" style={{ color: "var(--g-muted)" }}>
              Choisissez le type de modification
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-2 min-h-[44px] min-w-[44px]" aria-label="Fermer">
            <X className="w-5 h-5" style={{ color: "var(--g-muted)" }} />
          </button>
        </div>

        <div className="px-4 pb-6 space-y-4">
          {!showList ? (
            <>
              <div className="grid grid-cols-1 gap-2">
                {(
                  [
                    { id: "manuel" as const, label: "Marquer indisponible", desc: "Pluie, maintenance, fermeture exceptionnelle", Icon: CloudRain, color: "var(--g-danger)" },
                    allowTournoi
                      ? ({ id: "tournoi" as const, label: "Réserver pour un tournoi", desc: "Événement compétitif, journée ou demi-journée", Icon: Trophy, color: "var(--g-accent)" } as const)
                      : null,
                    allowAbonnement
                      ? ({ id: "abonnement" as const, label: "Créer un abonnement", desc: "Même créneau chaque semaine", Icon: Repeat, color: "var(--g-info)" } as const)
                      : null,
                  ] as Array<{
                    id: Mode;
                    label: string;
                    desc: string;
                    Icon: typeof CloudRain;
                    color: string;
                  } | null>
                )
                  .filter((t): t is NonNullable<typeof t> => t != null)
                  .map((t) => {
                  const selected = mode === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => {
                        setMode(t.id);
                        setSelected(new Set());
                      }}
                      className="text-left rounded-xl p-3 min-h-[64px] transition-colors"
                      style={{
                        background: selected ? `color-mix(in srgb, ${t.color} 12%, var(--g-surface))` : "var(--g-surface-2)",
                        border: `1.5px solid ${selected ? t.color : "var(--g-border)"}`,
                      }}
                    >
                      <span className="flex items-center gap-2 text-sm font-semibold" style={{ color: "var(--g-text)" }}>
                        <t.Icon className="w-4 h-4" style={{ color: t.color }} />
                        {t.label}
                      </span>
                      <span className="block text-[11px] mt-1" style={{ color: "var(--g-muted)" }}>{t.desc}</span>
                    </button>
                  );
                })}
              </div>

              {mode === "manuel" && (
                <>
                  <div>
                    <label className="text-xs font-semibold mb-1.5 block" style={{ color: "var(--g-text-2)" }}>
                      Date
                    </label>
                    <input
                      type="date"
                      value={date}
                      onChange={(e) => {
                        setDate(e.target.value);
                        setSelected(new Set());
                      }}
                      className="h-[48px] w-full px-3 rounded-xl text-sm outline-none"
                      style={{
                        background: "var(--g-surface-2)",
                        color: "var(--g-text)",
                        border: "1px solid var(--g-border)",
                      }}
                    />
                  </div>
                  <SlotPicker
                    loading={loadingSlots}
                    slots={freeSlots}
                    selected={selected}
                    onToggle={toggleSlot}
                  />
                  <div>
                    <p className="text-xs font-semibold mb-2" style={{ color: "var(--g-text-2)" }}>
                      Motif (optionnel)
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {MOTIFS.map((m) => {
                        const actif = motif === m.value;
                        return (
                          <button
                            key={m.value}
                            type="button"
                            onClick={() => setMotif(actif ? null : m.value)}
                            className="px-3 min-h-[44px] rounded-full text-sm font-semibold inline-flex items-center gap-1.5"
                            style={{
                              background: actif ? "var(--g-danger)" : "var(--g-surface-2)",
                              color: actif ? "#fff" : "var(--g-muted)",
                            }}
                          >
                            <m.Icon className="w-3.5 h-3.5" />
                            {m.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}

              {mode === "abonnement" && (
                <>
                  <Field label="Club / abonnement">
                    <input
                      value={libelle}
                      onChange={(e) => setLibelle(e.target.value)}
                      placeholder="Ex. ASC Jaraaf"
                      className="h-[48px] w-full px-3 rounded-xl text-sm outline-none"
                      style={fieldStyle}
                    />
                  </Field>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Du">
                      <input type="date" value={dateDebut} onChange={(e) => setDateDebut(e.target.value)} className="h-[48px] w-full px-3 rounded-xl text-sm outline-none" style={fieldStyle} />
                    </Field>
                    <Field label="Au">
                      <input type="date" value={dateFin} onChange={(e) => setDateFin(e.target.value)} className="h-[48px] w-full px-3 rounded-xl text-sm outline-none" style={fieldStyle} />
                    </Field>
                  </div>
                  <p className="text-xs font-semibold" style={{ color: "var(--g-text-2)" }}>
                    Jours de la semaine
                  </p>
                  <JourChips selected={joursAbo} onChange={setJoursAbo} />
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="De">
                      <input type="time" value={heureDebut} onChange={(e) => setHeureDebut(e.target.value)} className="h-[48px] w-full px-3 rounded-xl text-sm outline-none" style={fieldStyle} />
                    </Field>
                    <Field label="À">
                      <input type="time" value={heureFin} onChange={(e) => setHeureFin(e.target.value)} className="h-[48px] w-full px-3 rounded-xl text-sm outline-none" style={fieldStyle} />
                    </Field>
                  </div>
                  <MontantContratField
                    montant={montant}
                    onMontant={setMontant}
                    label="Montant prévu (optionnel)"
                    placeholder="Ex. 400000"
                  />
                </>
              )}

              {mode === "tournoi" && (
                <>
                  <Field label="Nom de l’événement">
                    <input
                      value={libelle}
                      onChange={(e) => setLibelle(e.target.value)}
                      placeholder="Ex. Tournoi Ramadan"
                      className="h-[48px] w-full px-3 rounded-xl text-sm outline-none"
                      style={fieldStyle}
                    />
                  </Field>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Date début">
                      <input
                        type="date"
                        value={dateDebut}
                        onChange={(e) => setDateDebut(e.target.value)}
                        className="h-[48px] w-full px-3 rounded-xl text-sm outline-none"
                        style={fieldStyle}
                      />
                    </Field>
                    <Field label="Date fin">
                      <input type="date" value={dateFin} onChange={(e) => setDateFin(e.target.value)} className="h-[48px] w-full px-3 rounded-xl text-sm outline-none" style={fieldStyle} />
                    </Field>
                  </div>
                  <p className="text-xs font-semibold" style={{ color: "var(--g-text-2)" }}>
                    Jours concernés
                  </p>
                  <JourChips selected={joursTournoi} onChange={setJoursTournoi} />
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="De">
                      <input type="time" value={heureDebut} onChange={(e) => setHeureDebut(e.target.value)} className="h-[48px] w-full px-3 rounded-xl text-sm outline-none" style={fieldStyle} />
                    </Field>
                    <Field label="À">
                      <input type="time" value={heureFin} onChange={(e) => setHeureFin(e.target.value)} className="h-[48px] w-full px-3 rounded-xl text-sm outline-none" style={fieldStyle} />
                    </Field>
                  </div>
                  <MontantContratField
                    montant={montant}
                    onMontant={setMontant}
                    label="Montant prévu (optionnel)"
                    placeholder="Ex. 1500000"
                  />
                </>
              )}

              <button
                type="button"
                disabled={busy || !canSubmit}
                onClick={() => {
                  if (!canSubmit) {
                    toast.error(
                      mode === "abonnement" || mode === "tournoi"
                        ? "Complète la période, les jours et le nom"
                        : "Sélectionne au moins un créneau",
                    );
                    return;
                  }
                  setConfirmBlock(true);
                }}
                className="w-full min-h-[48px] rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                style={{
                  background: mode === "abonnement" ? "var(--g-info)" : mode === "tournoi" ? "var(--g-accent)" : "var(--g-danger)",
                }}
              >
                {busy
                  ? "Enregistrement…"
                  : mode === "abonnement"
                    ? "Créer l'abonnement"
                    : mode === "tournoi"
                      ? "Réserver pour tournoi"
                      : "Marquer indisponible"}
              </button>

              <button
                type="button"
                onClick={() => setShowList(true)}
                className="w-full text-center text-sm font-semibold min-h-[44px]"
                style={{ color: "var(--g-primary)" }}
              >
                Voir les créneaux bloqués ({dayBlocages.length})
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setShowList(false)}
                className="text-sm font-semibold min-h-[44px]"
                style={{ color: "var(--g-primary)" }}
              >
                ← Retour
              </button>

              {groupes.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold" style={{ color: "var(--g-text-2)" }}>
                    Abonnements & tournois
                  </p>
                  {groupes.map((g) => (
                    <div
                      key={g.id}
                      className="rounded-xl p-3"
                      style={{ background: "var(--g-surface-2)", borderLeft: "4px solid var(--g-bloque)" }}
                    >
                      <p className="text-sm font-semibold" style={{ color: "var(--g-text)" }}>
                        {g.libelle || typeLabel(g.type_blocage)}
                      </p>
                      <p className="text-xs mt-0.5" style={{ color: "var(--g-muted)" }}>
                        {typeLabel(g.type_blocage)} · {String(g.date_debut || "").slice(0, 10)} → {String(g.date_fin || "").slice(0, 10)} · {g.nb_creneaux || 0} créneau(x)
                      </p>
                      {Number(g.montant_encaisse) > 0 ? (
                        <p className="text-xs mt-0.5" style={{ color: "var(--g-text-2)" }}>
                          Encaissé : {formatFcfa(g.montant_encaisse)}
                          {Number(g.montant_contrat) > 0 ? ` · Contrat ${formatFcfa(g.montant_contrat)}` : ""}
                        </p>
                      ) : (
                        <p className="text-xs mt-0.5" style={{ color: "var(--g-muted)" }}>
                          {g.type_blocage === "TOURNOI"
                            ? "Aucun montant encaissé pour ce tournoi"
                            : "Aucun montant encaissé pour cet abonnement"}
                        </p>
                      )}
                      <button
                        type="button"
                        onClick={() => void handleUnblockGroupe(g.id)}
                        className="text-xs font-semibold min-h-[44px] mt-1"
                        style={{ color: "var(--g-danger)" }}
                      >
                        Débloquer toute la série
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <ul className="space-y-2">
                {dayBlocages.length === 0 && (
                  <li className="text-sm text-center py-6" style={{ color: "var(--g-muted)" }}>
                    Aucun créneau bloqué ce jour
                  </li>
                )}
                {dayBlocages.map((b) => (
                  <li
                    key={b.id}
                    className="rounded-xl p-3 flex items-center gap-3"
                    style={{
                      background: "var(--g-surface-2)",
                      borderLeft: "4px solid var(--g-bloque)",
                    }}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold" style={{ color: "var(--g-text)" }}>
                        {formatPill(b.heure_debut, b.heure_fin)}
                      </p>
                      <p className="text-xs" style={{ color: "var(--g-muted)" }}>
                        {b.libelle || MOTIF_LABEL[String(b.motif || "")] || b.motif || typeLabel(b.type_blocage)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleUnblock(b.id)}
                      className="text-xs font-semibold min-h-[44px] px-3"
                      style={{ color: "var(--g-danger)" }}
                    >
                      Débloquer
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
      <ConfirmationModal
        ouvert={confirmBlock}
        titre={mode === "abonnement" ? "Créer cet abonnement ?" : mode === "tournoi" ? "Réserver ce tournoi ?" : "Marquer indisponible ?"}
        texte={confirmTexte}
        labelAnnuler="Annuler"
        labelConfirmer="Confirmer"
        variante="danger"
        onAnnuler={() => setConfirmBlock(false)}
        onConfirmer={() => {
          setConfirmBlock(false);
          void handleBlock();
        }}
      />
    </div>
  );
}

const fieldStyle = {
  background: "var(--g-surface-2)",
  color: "var(--g-text)",
  border: "1px solid var(--g-border)",
};

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="text-xs font-semibold mb-1.5 block" style={{ color: "var(--g-text-2)" }}>
        {label}
      </label>
      {children}
    </div>
  );
}

function JourChips({
  selected,
  onChange,
}: {
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {JOURS_ABO.map((j) => {
        const actif = selected.has(j.id);
        return (
          <button
            key={j.id}
            type="button"
            aria-pressed={actif}
            onClick={() => {
              const next = new Set(selected);
              if (next.has(j.id)) next.delete(j.id);
              else next.add(j.id);
              onChange(next);
            }}
            className="g-slot-toggle"
          >
            <span className="g-slot-knob">
              {actif ? <Check className="w-3 h-3 text-white" /> : null}
            </span>
            {j.label}
          </button>
        );
      })}
    </div>
  );
}

function MontantContratField({
  montant,
  onMontant,
  label,
  placeholder,
}: {
  montant: string;
  onMontant: (value: string) => void;
  label: string;
  placeholder: string;
}) {
  return (
    <div className="space-y-1.5">
      <Field label={label}>
        <input
          type="number"
          min={0}
          value={montant}
          onChange={(e) => onMontant(e.target.value)}
          placeholder={placeholder}
          className="h-[48px] w-full px-3 rounded-xl text-sm outline-none"
          style={fieldStyle}
        />
      </Field>
      <p className="text-[11px]" style={{ color: "var(--g-muted)" }}>
        Ce montant est prévu au contrat. Il ne compte pas comme argent reçu tant que tu n’encaisses pas.
      </p>
    </div>
  );
}

function SlotPicker({
  loading,
  slots,
  selected,
  onToggle,
  hint,
}: {
  loading: boolean;
  slots: FreeSlot[];
  selected: Set<string>;
  onToggle: (slot: FreeSlot) => void;
  hint?: string;
}) {
  return (
    <div>
      <p className="text-xs font-semibold mb-2" style={{ color: "var(--g-text-2)" }}>
        {hint || "Créneaux libres — sélection multiple"}
      </p>
      {loading ? (
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-12 w-32 animate-pulse rounded-[14px]" style={{ background: "var(--g-surface-2)" }} />
          ))}
        </div>
      ) : slots.length === 0 ? (
        <p className="text-sm py-4 text-center" style={{ color: "var(--g-muted)" }}>
          Aucun créneau libre ce jour
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {slots.map((slot) => {
            const key = slotKey(slot);
            const actif = selected.has(key);
            return (
              <button
                key={key}
                type="button"
                aria-pressed={actif}
                onClick={() => onToggle(slot)}
                className={cn("g-slot-toggle")}
              >
                <span className="g-slot-knob">
                  {actif ? <Check className="w-3 h-3 text-white" /> : null}
                </span>
                {formatPill(slot.heure_debut, slot.heure_fin)}
              </button>
            );
          })}
        </div>
      )}
      {selected.size > 0 ? (
        <p className="mt-2 text-xs" style={{ color: "var(--g-muted)" }}>
          {selected.size} sélectionné{selected.size > 1 ? "s" : ""}
        </p>
      ) : null}
    </div>
  );
}
