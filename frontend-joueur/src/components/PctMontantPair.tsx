import { useState } from "react";

export function montantDepuisPct(pct: number, base: number): number {
  if (!(base > 0) || !Number.isFinite(pct)) return 0;
  return Math.round((base * pct) / 100);
}

export function pctDepuisMontant(montant: number, base: number): number {
  if (!(base > 0) || !Number.isFinite(montant)) return 0;
  return Math.round((montant * 10000) / base) / 100;
}

export function formatPct(n: number): string {
  if (!Number.isFinite(n)) return "";
  const rounded = Math.round(n * 100) / 100;
  return String(rounded);
}

type Props = {
  label: string;
  hint?: string;
  labelMontant?: string;
  pct: string;
  onPctChange: (next: string) => void;
  base: number;
  disabled?: boolean;
  minPct?: number;
  maxPct?: number;
};

const inputClass = "w-full h-11 rounded-lg px-3 pr-12 text-sm";
const inputStyle = {
  border: "1px solid var(--sa-border, var(--color-border, #D4DBE6))",
  background: "var(--sa-surface, var(--color-surface, #fff))",
  color: "var(--sa-text, var(--color-text-primary, #0D1B2A))",
};

export default function PctMontantPair({
  label,
  hint,
  labelMontant = "Montant",
  pct,
  onPctChange,
  base,
  disabled,
  minPct = 0,
  maxPct = 100,
}: Props) {
  const pctNum = Number(pct);
  const derived = montantDepuisPct(Number.isFinite(pctNum) ? pctNum : 0, base);
  const [montantDraft, setMontantDraft] = useState<string | null>(null);

  function commitPct(raw: string) {
    setMontantDraft(null);
    if (raw === "" || raw === "." || raw.endsWith(".")) {
      onPctChange(raw);
      return;
    }
    const n = Number(raw.replace(",", "."));
    if (!Number.isFinite(n)) {
      onPctChange(raw);
      return;
    }
    const clamped = Math.min(maxPct, Math.max(minPct, n));
    onPctChange(formatPct(clamped));
  }

  function commitMontant(raw: string) {
    const cleaned = raw.replace(/\s/g, "").replace(",", ".");
    setMontantDraft(raw);
    if (cleaned === "" || cleaned === ".") {
      onPctChange("");
      return;
    }
    const n = Number(cleaned);
    if (!Number.isFinite(n) || !(base > 0)) return;
    const nextPct = pctDepuisMontant(n, base);
    onPctChange(formatPct(Math.min(maxPct, Math.max(minPct, nextPct))));
  }

  return (
    <div>
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-[12px] font-medium" style={{ color: "var(--sa-text-2, var(--color-text-secondary, #3D5166))" }}>
            {label}
          </span>
          <div className="mt-1 relative">
            <input
              className={inputClass}
              style={{
                ...inputStyle,
                background: disabled ? "var(--sa-surface-2, var(--color-surface-2, #F4F7FB))" : inputStyle.background,
              }}
              type="number"
              min={minPct}
              max={maxPct}
              step="0.1"
              disabled={disabled}
              value={pct}
              onChange={(e) => commitPct(e.target.value)}
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px]" style={{ color: "var(--sa-muted, var(--color-text-muted, #7A8FA6))" }}>
              %
            </span>
          </div>
        </label>
        <label className="block">
          <span className="text-[12px] font-medium" style={{ color: "var(--sa-text-2, var(--color-text-secondary, #3D5166))" }}>
            {labelMontant}
          </span>
          <div className="mt-1 relative">
            <input
              className={inputClass}
              style={{
                ...inputStyle,
                background: disabled ? "var(--sa-surface-2, var(--color-surface-2, #F4F7FB))" : inputStyle.background,
              }}
              type="number"
              min={0}
              step={1}
              disabled={disabled}
              value={montantDraft ?? (derived ? String(derived) : pct === "0" || pct === "" ? "" : "0")}
              onChange={(e) => commitMontant(e.target.value)}
              onBlur={() => setMontantDraft(null)}
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px]" style={{ color: "var(--sa-muted, var(--color-text-muted, #7A8FA6))" }}>
              F
            </span>
          </div>
        </label>
      </div>
      {hint ? (
        <span className="mt-1 block text-[11px]" style={{ color: "var(--sa-muted, var(--color-text-muted, #7A8FA6))" }}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}
