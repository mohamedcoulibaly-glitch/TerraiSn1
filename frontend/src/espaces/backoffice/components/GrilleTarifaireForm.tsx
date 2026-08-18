export type PrixBand = { demi: number; entier: number };

export type GrilleValues = {
  heure_pivot_semaine: string;
  heure_pivot_weekend: string;
  semaine: { avant: PrixBand; apres: PrixBand };
  weekend: { avant: PrixBand; apres: PrixBand };
};

export function emptyGrilleValues(base?: { entier?: number; demi?: number }): GrilleValues {
  const entier = Number(base?.entier || 0);
  const demi = Number(base?.demi || Math.round(entier / 2) || 0);
  const pair = { demi, entier };
  return {
    heure_pivot_semaine: "18:00",
    heure_pivot_weekend: "18:00",
    semaine: { avant: { ...pair }, apres: { ...pair } },
    weekend: { avant: { ...pair }, apres: { ...pair } },
  };
}

function setBand(
  value: GrilleValues,
  jour: "semaine" | "weekend",
  when: "avant" | "apres",
  field: "demi" | "entier",
  raw: string,
): GrilleValues {
  const n = Number(String(raw).replace(/\s/g, ""));
  return {
    ...value,
    [jour]: {
      ...value[jour],
      [when]: {
        ...value[jour][when],
        [field]: Number.isFinite(n) ? n : 0,
      },
    },
  };
}

function inputClass(disabled?: boolean) {
  return `h-11 w-full px-3 rounded-xl text-sm outline-none ${disabled ? "opacity-70" : ""}`;
}

function PrixInputs({
  label,
  band,
  disabled,
  onChange,
}: {
  label: string;
  band: PrixBand;
  disabled?: boolean;
  onChange: (field: "demi" | "entier", raw: string) => void;
}) {
  return (
    <div className="rounded-xl p-3 space-y-2" style={{ background: "var(--g-surface-2, #F4F7FB)" }}>
      <p className="text-xs font-semibold" style={{ color: "var(--g-text-2, #3D5166)" }}>
        {label}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <label className="block">
          <span className="text-[11px]" style={{ color: "var(--g-muted, #7A8FA6)" }}>
            Demi-terrain (FCFA / h)
          </span>
          <input
            type="number"
            min={0}
            step={500}
            disabled={disabled}
            value={band.demi || ""}
            onChange={(e) => onChange("demi", e.target.value)}
            className={inputClass(disabled)}
            style={{
              background: "var(--g-surface, #fff)",
              color: "var(--g-text, #0D1B2A)",
              border: "1px solid var(--g-border, #D4DBE6)",
            }}
          />
        </label>
        <label className="block">
          <span className="text-[11px]" style={{ color: "var(--g-muted, #7A8FA6)" }}>
            Terrain entier (FCFA / h)
          </span>
          <input
            type="number"
            min={0}
            step={500}
            disabled={disabled}
            value={band.entier || ""}
            onChange={(e) => onChange("entier", e.target.value)}
            className={inputClass(disabled)}
            style={{
              background: "var(--g-surface, #fff)",
              color: "var(--g-text, #0D1B2A)",
              border: "1px solid var(--g-border, #D4DBE6)",
            }}
          />
        </label>
      </div>
    </div>
  );
}

export default function GrilleTarifaireForm({
  value,
  onChange,
  disabled,
}: {
  value: GrilleValues;
  onChange: (next: GrilleValues) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <h3 className="text-sm font-semibold" style={{ color: "var(--g-text, #0D1B2A)" }}>
          Semaine (lundi au vendredi)
        </h3>
        <label className="block max-w-[180px]">
          <span className="text-[11px]" style={{ color: "var(--g-muted, #7A8FA6)" }}>
            Heure de soirée
          </span>
          <input
            type="time"
            disabled={disabled}
            value={value.heure_pivot_semaine}
            onChange={(e) => onChange({ ...value, heure_pivot_semaine: e.target.value || "18:00" })}
            className={inputClass(disabled)}
            style={{
              background: "var(--g-surface, #fff)",
              color: "var(--g-text, #0D1B2A)",
              border: "1px solid var(--g-border, #D4DBE6)",
            }}
          />
        </label>
        <PrixInputs
          label={`Avant ${value.heure_pivot_semaine.replace(":", "h")}`}
          band={value.semaine.avant}
          disabled={disabled}
          onChange={(field, raw) => onChange(setBand(value, "semaine", "avant", field, raw))}
        />
        <PrixInputs
          label={`À partir de ${value.heure_pivot_semaine.replace(":", "h")}`}
          band={value.semaine.apres}
          disabled={disabled}
          onChange={(field, raw) => onChange(setBand(value, "semaine", "apres", field, raw))}
        />
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold" style={{ color: "var(--g-text, #0D1B2A)" }}>
          Week-end (samedi et dimanche)
        </h3>
        <label className="block max-w-[180px]">
          <span className="text-[11px]" style={{ color: "var(--g-muted, #7A8FA6)" }}>
            Heure de soirée
          </span>
          <input
            type="time"
            disabled={disabled}
            value={value.heure_pivot_weekend}
            onChange={(e) => onChange({ ...value, heure_pivot_weekend: e.target.value || "18:00" })}
            className={inputClass(disabled)}
            style={{
              background: "var(--g-surface, #fff)",
              color: "var(--g-text, #0D1B2A)",
              border: "1px solid var(--g-border, #D4DBE6)",
            }}
          />
        </label>
        <PrixInputs
          label={`Avant ${value.heure_pivot_weekend.replace(":", "h")}`}
          band={value.weekend.avant}
          disabled={disabled}
          onChange={(field, raw) => onChange(setBand(value, "weekend", "avant", field, raw))}
        />
        <PrixInputs
          label={`À partir de ${value.heure_pivot_weekend.replace(":", "h")}`}
          band={value.weekend.apres}
          disabled={disabled}
          onChange={(field, raw) => onChange(setBand(value, "weekend", "apres", field, raw))}
        />
      </section>
    </div>
  );
}
