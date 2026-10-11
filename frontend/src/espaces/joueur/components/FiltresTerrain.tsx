import { useState, type ReactNode } from "react";
import { Calendar } from "lucide-react";
import Select2 from "@/components/Select2";
import DatePickerSheet from "@/espaces/backoffice/components/DatePickerSheet";
import { addDaysYmd, localYmd } from "@/lib/localDate";

export type FiltresTerrainValues = {
  date: string;
  heure: "" | "matin" | "apres-midi" | "soir";
  type: "" | "demi_terrain" | "terrain_entier";
  quartier: string;
  prix_max: number;
  distance_max: number;
};

export const FILTRES_TERRAIN_DEFAUT: FiltresTerrainValues = {
  date: "",
  heure: "",
  type: "",
  quartier: "",
  prix_max: 100000,
  distance_max: 10,
};

type Props = {
  value: FiltresTerrainValues;
  onChange: (next: FiltresTerrainValues) => void;
  onApply: () => void;
  onReset: () => void;
  geoAccordee: boolean;
  quartiers?: string[];
};

function Pill({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 min-h-[40px] rounded-full text-sm font-medium transition-colors flex-shrink-0 ${
        active
          ? "bg-[var(--color-primary)] text-white shadow-sm"
          : "bg-[var(--surface)] text-[var(--color-text-secondary)] border border-[var(--color-border)]"
      }`}
    >
      {children}
    </button>
  );
}

function formatDateLabel(ymd: string) {
  if (!ymd) return "Choisir une date";
  const d = new Date(`${ymd}T12:00:00`);
  if (Number.isNaN(d.getTime())) return ymd;
  if (ymd === localYmd()) return "Aujourd'hui";
  const raw = d.toLocaleDateString("fr-FR", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

export default function FiltresTerrain({
  value,
  onChange,
  onApply,
  onReset,
  geoAccordee,
  quartiers = [],
}: Props) {
  const [calendarOpen, setCalendarOpen] = useState(false);
  const set = <K extends keyof FiltresTerrainValues>(key: K, v: FiltresTerrainValues[K]) => {
    onChange({ ...value, [key]: v });
  };

  return (
    <div className="glass-card p-4 space-y-4 border border-[var(--color-border)] rounded-[var(--radius-lg)] bg-[var(--surface)]">
      <div>
        <p className="text-xs font-medium text-[var(--color-text-muted)] mb-1.5">Date souhaitée</p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setCalendarOpen(true)}
            className="flex-1 min-h-[48px] px-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2,#f5f5f5)] text-sm font-semibold inline-flex items-center gap-2 text-left active:scale-[0.99] transition-transform"
          >
            <Calendar className="w-5 h-5 shrink-0 text-[var(--color-primary)]" />
            <span className={value.date ? "text-[var(--color-text-primary)]" : "text-[var(--color-text-muted)]"}>
              {formatDateLabel(value.date)}
            </span>
          </button>
          {value.date ? (
            <button
              type="button"
              onClick={() => set("date", "")}
              className="shrink-0 min-h-[48px] px-3 rounded-[var(--radius-md)] border border-[var(--color-border)] text-sm font-medium text-[var(--color-text-secondary)]"
            >
              Effacer
            </button>
          ) : null}
        </div>
        <DatePickerSheet
          open={calendarOpen}
          onClose={() => setCalendarOpen(false)}
          value={value.date || localYmd()}
          min={localYmd()}
          max={addDaysYmd(localYmd(), 90)}
          onSelect={(ymd) => set("date", ymd)}
          title="Date souhaitée"
          appClass="joueur-app"
        />
      </div>

      <div>
        <p className="text-xs font-medium text-[var(--color-text-muted)] mb-1.5">Heure</p>
        <div className="flex gap-2 flex-wrap">
          {(
            [
              ["matin", "Matin"],
              ["apres-midi", "Après-midi"],
              ["soir", "Soir"],
            ] as const
          ).map(([id, label]) => (
            <Pill
              key={id}
              active={value.heure === id}
              onClick={() => set("heure", value.heure === id ? "" : id)}
            >
              {label}
            </Pill>
          ))}
        </div>
      </div>

      <div>
        <p className="text-xs font-medium text-[var(--color-text-muted)] mb-1.5">Type</p>
        <div className="flex gap-2 flex-wrap">
          <Pill
            active={value.type === "demi_terrain"}
            onClick={() => set("type", value.type === "demi_terrain" ? "" : "demi_terrain")}
          >
            Demi-terrain
          </Pill>
          <Pill
            active={value.type === "terrain_entier"}
            onClick={() => set("type", value.type === "terrain_entier" ? "" : "terrain_entier")}
          >
            Terrain entier
          </Pill>
        </div>
      </div>

      <div className={!geoAccordee ? "ring-2 ring-[var(--color-primary)]/30 rounded-[var(--radius-md)] p-2 -m-2" : ""}>
        <label
          htmlFor="filtre-quartier"
          className={`text-xs font-medium mb-1.5 block ${
            !geoAccordee ? "text-[var(--color-primary)]" : "text-[var(--color-text-muted)]"
          }`}
        >
          Quartier{!geoAccordee ? " (recommandé)" : ""}
        </label>
        {quartiers.length > 0 ? (
          <Select2
            value={value.quartier}
            onChange={(quartier) => set("quartier", quartier)}
            placeholder="Tous les quartiers"
            options={[
              { value: "", label: "Tous les quartiers" },
              ...quartiers.map((q) => ({ value: q, label: q })),
            ]}
          />
        ) : (
          <input
            id="filtre-quartier"
            type="text"
            placeholder="Ex. Almadies, Sacré-Cœur…"
            value={value.quartier}
            onChange={(e) => set("quartier", e.target.value)}
            className="w-full h-11 px-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--surface)] text-sm outline-none"
          />
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label htmlFor="filtre-prix" className="text-xs font-medium text-[var(--color-text-muted)]">
            Prix max
          </label>
          <span className="text-xs font-semibold text-[var(--color-primary)]">
            {value.prix_max.toLocaleString("fr-SN")} FCFA
          </span>
        </div>
        <input
          id="filtre-prix"
          type="range"
          min={5000}
          max={100000}
          step={1000}
          value={value.prix_max}
          onChange={(e) => set("prix_max", Number(e.target.value))}
          className="w-full accent-[var(--color-primary)]"
        />
      </div>

      {geoAccordee && (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label htmlFor="filtre-distance" className="text-xs font-medium text-[var(--color-text-muted)]">
              Distance max
            </label>
            <span className="text-xs font-semibold text-[var(--color-primary)]">{value.distance_max} km</span>
          </div>
          <input
            id="filtre-distance"
            type="range"
            min={1}
            max={20}
            step={1}
            value={value.distance_max}
            onChange={(e) => set("distance_max", Number(e.target.value))}
            className="w-full accent-[var(--color-primary)]"
          />
        </div>
      )}

      <button type="button" onClick={onApply} className="btn-primary w-full h-12">
        Appliquer les filtres
      </button>
      <button
        type="button"
        onClick={onReset}
        className="w-full h-11 rounded-[var(--radius-md)] border border-[var(--color-border)] text-sm font-medium text-[var(--color-text-secondary)] bg-[var(--surface)]"
      >
        Réinitialiser
      </button>
    </div>
  );
}
