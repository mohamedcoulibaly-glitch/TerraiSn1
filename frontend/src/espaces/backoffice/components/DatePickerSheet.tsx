import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { addDaysYmd, localYmd } from "@/lib/localDate";

type Props = {
  open: boolean;
  onClose: () => void;
  value: string;
  min?: string;
  max?: string;
  onSelect: (ymd: string) => void;
  title?: string;
  /** Classe racine thème (portail hors arbre) — `gerant-app` ou `joueur-app`. */
  appClass?: "gerant-app" | "joueur-app";
};

const WEEKDAYS = ["L", "M", "M", "J", "V", "S", "D"] as const;

function parseYmd(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 12, 0, 0);
}

function monthLabel(year: number, monthIndex: number) {
  const raw = new Date(year, monthIndex, 1, 12, 0, 0).toLocaleDateString("fr-FR", {
    month: "long",
    year: "numeric",
  });
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function buildMonthCells(year: number, monthIndex: number) {
  const first = new Date(year, monthIndex, 1, 12, 0, 0);
  const startOffset = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const cells: Array<{ ymd: string; day: number } | null> = [];

  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) {
    const ymd = `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    cells.push({ ymd, day });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

/** Tokens compatibles gérant (`--g-*`) et joueur (`--surface`, `--primary`…). */
const t = {
  surface: "var(--g-surface, var(--surface, #fff))",
  surface2: "var(--g-surface-2, var(--surface-2, #EEF2F8))",
  border: "var(--g-border-strong, var(--border-strong, #B8C4DA))",
  text: "var(--g-text, var(--text-primary, #0D1B2A))",
  muted: "var(--g-muted, var(--text-muted, #7A8FA6))",
  primary: "var(--g-primary, var(--primary, #1E40AF))",
  primaryGlow: "var(--g-primary-glow, var(--primary-glow, rgba(30,64,175,0.10)))",
};

export default function DatePickerSheet({
  open,
  onClose,
  value,
  min,
  max,
  onSelect,
  title = "Choisir une date",
  appClass = "gerant-app",
}: Props) {
  const today = localYmd();
  const minDate = min || today;
  const maxDate = max || addDaysYmd(today, 90);
  const selected = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : today;

  const initial = parseYmd(selected >= minDate ? selected : minDate);
  const [cursorYear, setCursorYear] = useState(initial.getFullYear());
  const [cursorMonth, setCursorMonth] = useState(initial.getMonth());

  useEffect(() => {
    if (!open) return;
    const d = parseYmd(selected >= minDate ? selected : minDate);
    setCursorYear(d.getFullYear());
    setCursorMonth(d.getMonth());
  }, [open, selected, minDate]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const cells = useMemo(() => buildMonthCells(cursorYear, cursorMonth), [cursorYear, cursorMonth]);

  const canPrev = useMemo(() => {
    const prevLast = localYmd(new Date(cursorYear, cursorMonth, 0, 12, 0, 0));
    return prevLast >= minDate;
  }, [cursorYear, cursorMonth, minDate]);

  const canNext = useMemo(() => {
    const nextFirst = localYmd(new Date(cursorYear, cursorMonth + 1, 1, 12, 0, 0));
    return nextFirst <= maxDate;
  }, [cursorYear, cursorMonth, maxDate]);

  const goPrev = () => {
    if (!canPrev) return;
    if (cursorMonth === 0) {
      setCursorYear((y) => y - 1);
      setCursorMonth(11);
    } else setCursorMonth((m) => m - 1);
  };

  const goNext = () => {
    if (!canNext) return;
    if (cursorMonth === 11) {
      setCursorYear((y) => y + 1);
      setCursorMonth(0);
    } else setCursorMonth((m) => m + 1);
  };

  if (!open) return null;

  return createPortal(
    <div className={`${appClass} fixed inset-0 z-[80] flex items-end justify-center md:items-center md:px-4`}>
      <button
        type="button"
        className="absolute inset-0 bg-black/45"
        aria-label="Fermer"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative w-full max-w-md rounded-t-3xl md:rounded-2xl px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]"
        style={{
          background: t.surface,
          boxShadow: "0 -8px 40px rgba(15, 23, 42, 0.18)",
        }}
      >
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full md:hidden" style={{ background: t.border }} />

        <div className="flex items-center justify-between gap-2 mb-4">
          <h2
            className="text-base font-bold"
            style={{ color: t.text, fontFamily: "var(--font-display, Outfit, sans-serif)" }}
          >
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="h-11 w-11 rounded-full inline-flex items-center justify-center"
            style={{ background: t.surface2, color: t.muted }}
            aria-label="Fermer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex items-center justify-between gap-2 mb-3">
          <button
            type="button"
            onClick={goPrev}
            disabled={!canPrev}
            className="h-11 w-11 rounded-full inline-flex items-center justify-center disabled:opacity-30"
            style={{ background: t.surface2, color: t.text }}
            aria-label="Mois précédent"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <p
            className="text-sm font-bold capitalize flex-1 text-center"
            style={{ color: t.text, fontFamily: "var(--font-display, Outfit, sans-serif)" }}
          >
            {monthLabel(cursorYear, cursorMonth)}
          </p>
          <button
            type="button"
            onClick={goNext}
            disabled={!canNext}
            className="h-11 w-11 rounded-full inline-flex items-center justify-center disabled:opacity-30"
            style={{ background: t.surface2, color: t.text }}
            aria-label="Mois suivant"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>

        <div className="grid grid-cols-7 gap-1 mb-1">
          {WEEKDAYS.map((d, i) => (
            <div
              key={`${d}-${i}`}
              className="h-9 flex items-center justify-center text-[11px] font-semibold"
              style={{ color: t.muted }}
            >
              {d}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1">
          {cells.map((cell, idx) => {
            if (!cell) {
              return <div key={`empty-${idx}`} className="aspect-square min-h-[44px]" />;
            }
            const disabled = cell.ymd < minDate || cell.ymd > maxDate;
            const isToday = cell.ymd === today;
            const isSelected = cell.ymd === selected;
            return (
              <button
                key={cell.ymd}
                type="button"
                disabled={disabled}
                onClick={() => {
                  onSelect(cell.ymd);
                  onClose();
                }}
                className="aspect-square min-h-[44px] rounded-2xl inline-flex flex-col items-center justify-center text-sm font-semibold disabled:opacity-25 disabled:pointer-events-none active:scale-95 transition-transform"
                style={{
                  background: isSelected ? t.primary : isToday ? t.primaryGlow : "transparent",
                  color: isSelected ? "#fff" : isToday ? t.primary : t.text,
                  boxShadow: isSelected
                    ? "0 0 0 2px color-mix(in srgb, var(--g-primary, var(--primary, #1E40AF)) 25%, transparent)"
                    : undefined,
                }}
              >
                <span className="text-[15px] leading-none">{cell.day}</span>
                {isToday && !isSelected ? (
                  <span className="mt-1 h-1 w-1 rounded-full" style={{ background: t.primary }} />
                ) : null}
              </button>
            );
          })}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => {
              onSelect(today);
              onClose();
            }}
            className="min-h-[48px] rounded-xl text-sm font-semibold"
            style={{ background: t.surface2, color: t.text }}
          >
            Aujourd&apos;hui
          </button>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[48px] rounded-xl text-sm font-semibold text-white"
            style={{ background: t.primary }}
          >
            Fermer
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
