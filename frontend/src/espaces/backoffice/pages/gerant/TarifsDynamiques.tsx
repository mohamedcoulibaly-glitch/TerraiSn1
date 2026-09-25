import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BadgePercent,
  Check,
  Moon,
  RotateCcw,
  Save,
  Sun,
  TrendingDown,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { gerantApi } from "@/lib/api";

type Cellule = {
  jour: string;
  heure: number;
  prix_entier: number;
  prix_moitie: number;
  est_personnalise?: boolean;
  ruleHint?: string;
};

type Grille = {
  terrain_id: number;
  prix_entier_base: number;
  prix_moitie_base: number;
  pourcentage_avance: number;
  heure_min: number;
  heure_max: number;
  jours: string[];
  cellules: Cellule[];
};

const JOUR_LABEL: Record<string, string> = {
  lundi: "Lun",
  mardi: "Mar",
  mercredi: "Mer",
  jeudi: "Jeu",
  vendredi: "Ven",
  samedi: "Sam",
  dimanche: "Dim",
};

const JOURS_ORDRE = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
const WEEKDAYS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi"];

function formatFcfa(n: number) {
  return `${Number(n || 0).toLocaleString("fr-FR")} F`;
}

function keyOf(jour: string, heure: number) {
  return `${jour}-${heure}`;
}

/** Heatmap : base neutre → jaune → orange → rouge (pic) / bas → vert */
function heatStyle(price: number, base: number): { bg: string; text: string } {
  if (!(base > 0) || !(price > 0)) {
    return { bg: "bg-[var(--color-surface-2)]", text: "text-[var(--color-text-primary)]" };
  }
  const ratio = price / base;
  if (ratio <= 0.9) {
    return {
      bg: "bg-[color-mix(in_srgb,var(--color-success)_18%,white)]",
      text: "text-[var(--color-success)]",
    };
  }
  if (Math.abs(ratio - 1) < 0.03) {
    return {
      bg: "bg-[color-mix(in_srgb,var(--color-success)_8%,white)]",
      text: "text-[var(--color-text-primary)]",
    };
  }
  if (ratio < 1.15) {
    return {
      bg: "bg-[color-mix(in_srgb,#E8B84A_22%,white)]",
      text: "text-[var(--color-text-primary)]",
    };
  }
  if (ratio < 1.35) {
    return {
      bg: "bg-[color-mix(in_srgb,#E07A3D_28%,white)]",
      text: "text-[var(--color-text-primary)]",
    };
  }
  return {
    bg: "bg-[color-mix(in_srgb,var(--color-danger)_22%,white)]",
    text: "text-[var(--color-danger)]",
  };
}

function tooltipFor(cell: Cellule | undefined, base: number, formatVue: "entier" | "moitie") {
  if (!cell) return "";
  const price = formatVue === "moitie" ? cell.prix_moitie : cell.prix_entier;
  if (!cell.est_personnalise || !(base > 0)) {
    return `Prix de base ${formatFcfa(base)}`;
  }
  if (cell.ruleHint) {
    return `Prix de base ${formatFcfa(base)} · ${cell.ruleHint} = ${formatFcfa(price)}`;
  }
  const pct = Math.round(((price - base) / base) * 100);
  const sign = pct >= 0 ? `+${pct}` : `${pct}`;
  return `Prix de base ${formatFcfa(base)} · ${sign} % = ${formatFcfa(price)}`;
}

function Skeleton() {
  return (
    <div className="max-w-5xl mx-auto space-y-4 animate-pulse pb-28">
      <div className="h-8 w-56 rounded bg-[var(--color-surface-2)]" />
      <div className="h-24 rounded-[var(--radius-lg)] bg-[var(--color-surface-2)]" />
      <div className="grid grid-cols-3 gap-3">
        <div className="h-20 rounded-[var(--radius-md)] bg-[var(--color-surface-2)]" />
        <div className="h-20 rounded-[var(--radius-md)] bg-[var(--color-surface-2)]" />
        <div className="h-20 rounded-[var(--radius-md)] bg-[var(--color-surface-2)]" />
      </div>
      <div className="h-80 rounded-[var(--radius-lg)] bg-[var(--color-surface-2)]" />
    </div>
  );
}

export default function TarifsDynamiques() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [baseEntier, setBaseEntier] = useState(0);
  const [baseMoitie, setBaseMoitie] = useState(0);
  const [pctAvance, setPctAvance] = useState(12.5);
  const [heures, setHeures] = useState<number[]>([]);
  const [map, setMap] = useState<Record<string, Cellule>>({});
  const [formatVue, setFormatVue] = useState<"entier" | "moitie">("entier");
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [quickPrice, setQuickPrice] = useState("");
  const [dragAnchor, setDragAnchor] = useState<{ jour: string; heure: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const baselineRef = useRef<Record<string, Cellule>>({});

  const load = async () => {
    setLoading(true);
    try {
      const data = (await gerantApi.getTarifs()) as Grille;
      setBaseEntier(Number(data.prix_entier_base));
      setBaseMoitie(Number(data.prix_moitie_base));
      setPctAvance(Number(data.pourcentage_avance || 12.5));
      const hs: number[] = [];
      for (let h = data.heure_min; h < data.heure_max; h += 1) {
        if (h >= 0 && h < 24) hs.push(h);
      }
      setHeures(hs);
      const next: Record<string, Cellule> = {};
      for (const c of data.cellules || []) {
        next[keyOf(c.jour, c.heure)] = { ...c };
      }
      setMap(next);
      baselineRef.current = structuredClone(next);
      setDirty(false);
      setSelection(new Set());
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Impossible de charger les tarifs");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    const end = () => setIsDragging(false);
    window.addEventListener("mouseup", end);
    window.addEventListener("touchend", end);
    return () => {
      window.removeEventListener("mouseup", end);
      window.removeEventListener("touchend", end);
    };
  }, []);

  const basePrice = formatVue === "moitie" ? baseMoitie : baseEntier;

  const modifiedCount = useMemo(() => {
    let n = 0;
    for (const [k, cell] of Object.entries(map)) {
      const base = baselineRef.current[k];
      if (!base) {
        if (cell.est_personnalise) n += 1;
        continue;
      }
      if (
        cell.prix_entier !== base.prix_entier ||
        cell.prix_moitie !== base.prix_moitie ||
        Boolean(cell.est_personnalise) !== Boolean(base.est_personnalise)
      ) {
        n += 1;
      }
    }
    return n;
  }, [map]);

  const markCell = useCallback(
    (
      cell: Cellule,
      pe: number,
      pm: number,
      hint?: string,
    ): Cellule => ({
      ...cell,
      prix_entier: pe,
      prix_moitie: pm,
      est_personnalise: pe !== baseEntier || pm !== baseMoitie,
      ruleHint: hint,
    }),
    [baseEntier, baseMoitie],
  );

  const rectSelect = useCallback(
    (a: { jour: string; heure: number }, b: { jour: string; heure: number }) => {
      const jiA = JOURS_ORDRE.indexOf(a.jour);
      const jiB = JOURS_ORDRE.indexOf(b.jour);
      if (jiA < 0 || jiB < 0) return new Set<string>();
      const jMin = Math.min(jiA, jiB);
      const jMax = Math.max(jiA, jiB);
      const hMin = Math.min(a.heure, b.heure);
      const hMax = Math.max(a.heure, b.heure);
      const next = new Set<string>();
      for (let ji = jMin; ji <= jMax; ji += 1) {
        for (let h = hMin; h <= hMax; h += 1) {
          if (!heures.includes(h)) continue;
          const k = keyOf(JOURS_ORDRE[ji], h);
          if (map[k]) next.add(k);
        }
      }
      return next;
    },
    [heures, map],
  );

  const onCellPointerDown = (jour: string, heure: number) => {
    setIsDragging(true);
    setDragAnchor({ jour, heure });
    setSelection(new Set([keyOf(jour, heure)]));
    const cell = map[keyOf(jour, heure)];
    if (cell) {
      setQuickPrice(String(formatVue === "moitie" ? cell.prix_moitie : cell.prix_entier));
    }
  };

  const onCellPointerEnter = (jour: string, heure: number) => {
    if (!isDragging || !dragAnchor) return;
    setSelection(rectSelect(dragAnchor, { jour, heure }));
  };

  const applyFixedToSelection = (price: number) => {
    if (!(price > 0) || selection.size === 0) {
      toast.error("Sélectionnez des cases et un prix positif");
      return;
    }
    setMap((prev) => {
      const next = { ...prev };
      for (const k of selection) {
        const cell = next[k];
        if (!cell) continue;
        if (formatVue === "moitie") {
          next[k] = markCell(cell, cell.prix_entier, price, `Prix fixe ${formatFcfa(price)}`);
        } else {
          const ratio = baseEntier > 0 ? baseMoitie / baseEntier : 0.6;
          next[k] = markCell(
            cell,
            price,
            Math.round(price * ratio),
            `Prix fixe ${formatFcfa(price)}`,
          );
        }
      }
      return next;
    });
    setDirty(true);
    toast.success(`${selection.size} créneau${selection.size > 1 ? "x" : ""} mis à jour`);
  };

  const applyPercentToSelection = (pct: number) => {
    if (selection.size === 0) return;
    const factor = 1 + pct / 100;
    setMap((prev) => {
      const next = { ...prev };
      for (const k of selection) {
        const cell = next[k];
        if (!cell) continue;
        const pe = Math.round(baseEntier * factor);
        const pm = Math.round(baseMoitie * factor);
        const sign = pct >= 0 ? `+${pct}` : `${pct}`;
        next[k] = markCell(cell, pe, pm, `Variation rapide (${sign} %)`);
      }
      return next;
    });
    setDirty(true);
    toast.success(`Variation ${pct > 0 ? "+" : ""}${pct} % sur ${selection.size} créneau(x)`);
  };

  const resetSelectionToBase = () => {
    if (selection.size === 0) return;
    setMap((prev) => {
      const next = { ...prev };
      for (const k of selection) {
        const cell = next[k];
        if (!cell) continue;
        next[k] = {
          ...cell,
          prix_entier: baseEntier,
          prix_moitie: baseMoitie,
          est_personnalise: false,
          ruleHint: undefined,
        };
      }
      return next;
    });
    setDirty(true);
    toast.success("Prix de base rétabli sur la sélection");
  };

  const applyPreset = (kind: "soir" | "weekend" | "creuses" | "reset") => {
    setMap((prev) => {
      const next = { ...prev };
      for (const [k, cell] of Object.entries(next)) {
        if (kind === "reset") {
          next[k] = {
            ...cell,
            prix_entier: baseEntier,
            prix_moitie: baseMoitie,
            est_personnalise: false,
            ruleHint: undefined,
          };
          continue;
        }
        const isWeekend = cell.jour === "samedi" || cell.jour === "dimanche";
        const isWeekday = WEEKDAYS.includes(cell.jour);
        const isSoir = cell.heure >= 18 && cell.heure <= 21;
        const isCreuse = isWeekday && cell.heure >= 8 && cell.heure < 14;

        if (kind === "soir" && isSoir) {
          next[k] = markCell(
            cell,
            Math.round(baseEntier * 1.3),
            Math.round(baseMoitie * 1.3),
            "Majoration Soirée (+30 %)",
          );
        }
        if (kind === "weekend" && isWeekend) {
          next[k] = markCell(
            cell,
            Math.round(baseEntier * 1.2),
            Math.round(baseMoitie * 1.2),
            "Majoration Weekend (+20 %)",
          );
        }
        if (kind === "creuses" && isCreuse) {
          next[k] = markCell(
            cell,
            Math.round(baseEntier * 0.85),
            Math.round(baseMoitie * 0.85),
            "Heures creuses (−15 %)",
          );
        }
      }
      return next;
    });
    setDirty(true);
    const messages = {
      soir: "Soirée +30 % (18h–22h, toute la semaine)",
      weekend: "Weekend +20 % (samedi & dimanche)",
      creuses: "Heures creuses −15 % (lun–ven, 8h–14h)",
      reset: "Tous les tarifs remis au prix de base",
    };
    toast.success(messages[kind]);
  };

  const save = async () => {
    if (!(baseEntier > 0) || !(baseMoitie > 0)) {
      toast.error("Définissez des tarifs de base positifs");
      return;
    }
    setSaving(true);
    try {
      const cellules = Object.values(map).map((c) => ({
        jour: c.jour,
        heure: c.heure,
        prix_entier: Number(c.prix_entier),
        prix_moitie: Number(c.prix_moitie),
      }));
      await gerantApi.saveTarifs({
        prix_entier_base: Number(baseEntier),
        prix_moitie_base: Number(baseMoitie),
        cellules,
      });
      toast.success("Tarifs enregistrés");
      await load();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Échec de l'enregistrement");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Skeleton />;

  const selectionCount = selection.size;
  const showToolbar = selectionCount > 0;

  return (
    <div className="max-w-5xl mx-auto space-y-5 pb-[calc(7.5rem+env(safe-area-inset-bottom))] md:pb-28">
      <header>
        <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)] flex items-center gap-1.5">
          <BadgePercent className="w-3.5 h-3.5" /> Prix dynamiques
        </p>
        <h1
          className="text-2xl font-semibold text-[var(--color-text-primary)] mt-1"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Tarifs par jour & heure
        </h1>
        <p className="text-sm text-[var(--color-text-secondary)] mt-1 max-w-xl">
          Glissez sur la grille pour sélectionner, appliquez un preset ou un % — les joueurs voient
          le prix exact avant de réserver.
        </p>
      </header>

      {/* Bases */}
      <section className="rounded-[var(--radius-lg)] bg-white border border-[var(--color-border)] p-4 md:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Tarifs de base</h2>
          <div className="inline-flex rounded-full border border-[var(--color-border)] p-0.5 bg-[var(--color-surface-2)]">
            {(["entier", "moitie"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFormatVue(f)}
                className={`px-3 min-h-[32px] rounded-full text-xs font-medium transition-colors ${
                  formatVue === f
                    ? "bg-[var(--color-primary)] text-white"
                    : "text-[var(--color-text-secondary)]"
                }`}
              >
                {f === "entier" ? "Entier" : "Moitié"}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="block">
            <span className="text-xs text-[var(--color-text-muted)]">Terrain entier / h</span>
            <input
              type="number"
              min={500}
              step={500}
              value={baseEntier}
              onChange={(e) => {
                const next = Number(e.target.value);
                setBaseEntier(next);
                setMap((prev) => {
                  const updated = { ...prev };
                  for (const [k, cell] of Object.entries(updated)) {
                    if (!cell.est_personnalise) updated[k] = { ...cell, prix_entier: next };
                  }
                  return updated;
                });
                setDirty(true);
              }}
              className="mt-1 w-full h-11 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-sm outline-none focus:border-[var(--color-primary)]"
            />
          </label>
          <label className="block">
            <span className="text-xs text-[var(--color-text-muted)]">Moitié / h</span>
            <input
              type="number"
              min={500}
              step={500}
              value={baseMoitie}
              onChange={(e) => {
                const next = Number(e.target.value);
                setBaseMoitie(next);
                setMap((prev) => {
                  const updated = { ...prev };
                  for (const [k, cell] of Object.entries(updated)) {
                    if (!cell.est_personnalise) updated[k] = { ...cell, prix_moitie: next };
                  }
                  return updated;
                });
                setDirty(true);
              }}
              className="mt-1 w-full h-11 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 text-sm outline-none focus:border-[var(--color-primary)]"
            />
          </label>
          <div className="rounded-[var(--radius-md)] bg-[var(--color-surface-2)] px-3 py-2.5 flex flex-col justify-center">
            <span className="text-xs text-[var(--color-text-muted)]">Avance demandée</span>
            <span className="text-sm font-semibold text-[var(--color-text-primary)] mt-0.5">
              {pctAvance} % du total
            </span>
          </div>
        </div>
      </section>

      {/* Presets one-click */}
      <section>
        <h2 className="text-sm font-semibold mb-2">Règles rapides</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <button
            type="button"
            onClick={() => applyPreset("soir")}
            className="text-left rounded-[var(--radius-md)] border border-[var(--color-border)] bg-white p-3.5 hover:border-[var(--color-primary)] transition-colors group"
          >
            <div className="flex items-center gap-2 text-[var(--color-primary)]">
              <Moon className="w-4 h-4" />
              <span className="text-sm font-semibold">Soirée +30 %</span>
            </div>
            <p className="text-[11px] text-[var(--color-text-muted)] mt-1.5 leading-snug">
              18h–22h · lundi → dimanche
            </p>
          </button>
          <button
            type="button"
            onClick={() => applyPreset("weekend")}
            className="text-left rounded-[var(--radius-md)] border border-[var(--color-border)] bg-white p-3.5 hover:border-[var(--color-primary)] transition-colors"
          >
            <div className="flex items-center gap-2 text-[var(--color-primary)]">
              <Sun className="w-4 h-4" />
              <span className="text-sm font-semibold">Weekend +20 %</span>
            </div>
            <p className="text-[11px] text-[var(--color-text-muted)] mt-1.5 leading-snug">
              Samedi & dimanche · toute la journée
            </p>
          </button>
          <button
            type="button"
            onClick={() => applyPreset("creuses")}
            className="text-left rounded-[var(--radius-md)] border border-[var(--color-border)] bg-white p-3.5 hover:border-[var(--color-primary)] transition-colors"
          >
            <div className="flex items-center gap-2 text-[var(--color-success)]">
              <TrendingDown className="w-4 h-4" />
              <span className="text-sm font-semibold">Heures creuses −15 %</span>
            </div>
            <p className="text-[11px] text-[var(--color-text-muted)] mt-1.5 leading-snug">
              Lun–ven · 08h–14h
            </p>
          </button>
          <button
            type="button"
            onClick={() => applyPreset("reset")}
            className="text-left rounded-[var(--radius-md)] border border-[var(--color-border)] bg-white p-3.5 hover:border-[var(--color-danger)] transition-colors"
          >
            <div className="flex items-center gap-2 text-[var(--color-text-secondary)]">
              <RotateCcw className="w-4 h-4" />
              <span className="text-sm font-semibold">Rétablir les défauts</span>
            </div>
            <p className="text-[11px] text-[var(--color-text-muted)] mt-1.5 leading-snug">
              Remet toute la grille au prix de base
            </p>
          </button>
        </div>
      </section>

      {/* Légende heatmap */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-[var(--color-text-muted)]">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm bg-[color-mix(in_srgb,var(--color-success)_18%,white)] border border-[var(--color-border)]" />
          Creux / base
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm bg-[color-mix(in_srgb,#E8B84A_22%,white)] border border-[var(--color-border)]" />
          Léger +
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm bg-[color-mix(in_srgb,#E07A3D_28%,white)] border border-[var(--color-border)]" />
          Fort +
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm bg-[color-mix(in_srgb,var(--color-danger)_22%,white)] border border-[var(--color-border)]" />
          Pic
        </span>
        <span className="inline-flex items-center gap-1 ml-auto">
          <Sun className="w-3 h-3" /> jour · <Moon className="w-3 h-3 ml-1" /> soir (≥18h)
        </span>
      </div>

      {/* Grille */}
      <section className="rounded-[var(--radius-lg)] bg-white border border-[var(--color-border)] overflow-hidden select-none">
        <div className="px-4 py-3 border-b border-[var(--color-border)]">
          <h2 className="text-sm font-semibold">Grille horaire</h2>
          <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">
            Cliquez-glissez pour sélectionner un bloc de créneaux
          </p>
        </div>

        <div className="overflow-x-auto" ref={gridRef}>
          <div
            className="min-w-[760px] grid"
            style={{ gridTemplateColumns: `72px repeat(${JOURS_ORDRE.length}, minmax(88px, 1fr))` }}
          >
            <div className="sticky left-0 z-10 bg-white border-b border-[var(--color-border)] p-2" />
            {JOURS_ORDRE.map((jour) => (
              <div
                key={jour}
                className="border-b border-l border-[var(--color-border)] p-2 text-center text-xs font-semibold"
              >
                {JOUR_LABEL[jour]}
              </div>
            ))}

            {heures.map((heure) => (
              <div key={`row-${heure}`} className="contents">
                <div className="sticky left-0 z-10 bg-white border-b border-[var(--color-border)] px-2 py-2 text-[11px] font-medium text-[var(--color-text-muted)] flex items-center gap-1.5">
                  {heure >= 18 || heure === 0 ? (
                    <Moon className="w-3 h-3 shrink-0 opacity-60" aria-hidden />
                  ) : (
                    <Sun className="w-3 h-3 shrink-0 opacity-60" aria-hidden />
                  )}
                  <span>{heure === 0 ? "Minuit" : `${String(heure).padStart(2, "0")}h`}</span>
                </div>
                {JOURS_ORDRE.map((jour) => {
                  const k = keyOf(jour, heure);
                  const cell = map[k];
                  const price =
                    formatVue === "moitie"
                      ? Number(cell?.prix_moitie || baseMoitie)
                      : Number(cell?.prix_entier || baseEntier);
                  const heat = heatStyle(price, basePrice);
                  const selected = selection.has(k);
                  const tip = tooltipFor(cell, basePrice, formatVue);
                  return (
                    <button
                      key={k}
                      type="button"
                      title={tip}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        onCellPointerDown(jour, heure);
                      }}
                      onMouseEnter={() => onCellPointerEnter(jour, heure)}
                      onTouchStart={(e) => {
                        e.preventDefault();
                        onCellPointerDown(jour, heure);
                      }}
                      onTouchMove={(e) => {
                        const touch = e.touches[0];
                        if (!touch || !gridRef.current) return;
                        const el = document.elementFromPoint(touch.clientX, touch.clientY) as
                          | HTMLElement
                          | null;
                        const btn = el?.closest("[data-tarif-cell]") as HTMLElement | null;
                        if (!btn) return;
                        const j = btn.dataset.jour;
                        const h = Number(btn.dataset.heure);
                        if (j && Number.isFinite(h)) onCellPointerEnter(j, h);
                      }}
                      data-tarif-cell
                      data-jour={jour}
                      data-heure={heure}
                      className={`relative border-b border-l border-[var(--color-border)] min-h-[52px] px-1.5 py-1.5 text-left transition-[box-shadow,transform] ${heat.bg} ${
                        selected ? "ring-2 ring-inset ring-[var(--color-primary)] z-[1]" : ""
                      }`}
                    >
                      <span className={`block text-[11px] font-semibold ${heat.text}`}>
                        {formatFcfa(price)}
                      </span>
                      {cell?.est_personnalise && (
                        <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-[var(--color-accent)]" />
                      )}
                      {selected && (
                        <span className="absolute bottom-1 right-1 text-[var(--color-primary)]">
                          <Check className="w-3 h-3" />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Toolbar flottante contextuelle */}
      {showToolbar && (
        <div className="fixed left-1/2 -translate-x-1/2 z-40 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] md:bottom-20 w-[min(96vw,36rem)]">
          <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-white shadow-xl p-3 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-[var(--color-text-primary)]">
                {selectionCount} créneau{selectionCount > 1 ? "x" : ""} sélectionné
                {selectionCount > 1 ? "s" : ""}
              </p>
              <button
                type="button"
                aria-label="Fermer"
                onClick={() => setSelection(new Set())}
                className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5 flex-1 min-w-[9rem]">
                <input
                  type="number"
                  min={500}
                  step={500}
                  value={quickPrice}
                  onChange={(e) => setQuickPrice(e.target.value)}
                  placeholder="Prix FCFA"
                  className="w-full h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] px-2.5 text-sm"
                />
                <button
                  type="button"
                  onClick={() => applyFixedToSelection(Number(quickPrice))}
                  className="shrink-0 h-10 px-3 rounded-[var(--radius-md)] bg-[var(--color-primary)] text-white text-xs font-medium"
                >
                  Fixer
                </button>
              </div>
              <div className="flex flex-wrap gap-1">
                {[10, 20, 30].map((p) => (
                  <button
                    key={`p${p}`}
                    type="button"
                    onClick={() => applyPercentToSelection(p)}
                    className="h-9 px-2.5 rounded-full border border-[var(--color-border)] text-xs font-medium hover:border-[var(--color-primary)]"
                  >
                    +{p}%
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => applyPercentToSelection(-10)}
                  className="h-9 px-2.5 rounded-full border border-[var(--color-border)] text-xs font-medium hover:border-[var(--color-success)]"
                >
                  −10%
                </button>
                <button
                  type="button"
                  onClick={resetSelectionToBase}
                  className="h-9 px-2.5 rounded-full border border-[var(--color-border)] text-xs font-medium inline-flex items-center gap-1"
                >
                  <RotateCcw className="w-3 h-3" /> Base
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Sticky save */}
      <div className="fixed inset-x-0 z-40 bottom-[calc(56px+env(safe-area-inset-bottom))] md:bottom-0 border-t border-[var(--color-border)] bg-white/95 backdrop-blur-sm">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <p className="text-sm text-[var(--color-text-secondary)]">
            {dirty || modifiedCount > 0 ? (
              <>
                <span className="font-semibold text-[var(--color-text-primary)]">
                  {modifiedCount || "—"} créneau{(modifiedCount || 0) > 1 ? "x" : ""} modifié
                  {(modifiedCount || 0) > 1 ? "s" : ""}
                </span>
                <span className="text-[var(--color-warning)]"> — non enregistré</span>
              </>
            ) : (
              "Aucune modification"
            )}
          </p>
          <button
            type="button"
            onClick={save}
            disabled={saving || (!dirty && modifiedCount === 0)}
            className="inline-flex items-center gap-2 min-h-[44px] px-5 rounded-[var(--radius-md)] bg-[var(--color-primary)] text-white text-sm font-medium disabled:opacity-45 hover:bg-[var(--color-primary-light)]"
          >
            <Save className="w-4 h-4" />
            {saving ? "Enregistrement…" : "Enregistrer"}
          </button>
        </div>
      </div>
    </div>
  );
}
