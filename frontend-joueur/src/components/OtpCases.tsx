import { useRef, type ClipboardEvent, type KeyboardEvent } from "react";

interface OtpCasesProps {
  value: string;
  onChange: (v: string) => void;
  theme: "joueur" | "backoffice";
  disabled?: boolean;
  /** Nombre de cases (4 par défaut pour joueur — moins intimidant). */
  length?: number;
}

export default function OtpCases({
  value,
  onChange,
  theme,
  disabled,
  length = 4,
}: OtpCasesProps) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const primary = theme === "joueur" ? "var(--lj-primary)" : "var(--lb-primary)";
  const glow = theme === "joueur" ? "var(--lj-primary-glow)" : "var(--lb-primary-glow)";
  const border = theme === "joueur" ? "var(--lj-border)" : "var(--lb-border)";
  const surface = theme === "joueur" ? "var(--lj-surface, var(--surface-2))" : "var(--surface-2)";
  const n = Math.max(4, Math.min(8, length));
  const last = n - 1;

  const setDigit = (index: number, raw: string) => {
    const digit = raw.replace(/\D/g, "").slice(-1);
    const arr = Array.from({ length: n }, (_, i) => value[i] || "");
    arr[index] = digit;
    onChange(arr.join(""));
    if (digit && index < last) refs.current[index + 1]?.focus();
  };

  const onKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !value[index] && index > 0) {
      refs.current[index - 1]?.focus();
    }
  };

  const onPaste = (e: ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, n);
    if (!pasted) return;
    onChange(pasted);
    refs.current[Math.min(pasted.length, last)]?.focus();
  };

  return (
    <div className="flex gap-3 justify-center" onPaste={onPaste}>
      {Array.from({ length: n }).map((_, i) => {
        const filled = !!value[i];
        return (
          <input
            key={i}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="tel"
            inputMode="numeric"
            autoComplete={i === 0 ? "one-time-code" : "off"}
            maxLength={1}
            disabled={disabled}
            value={value[i] || ""}
            onChange={(e) => setDigit(i, e.target.value)}
            onKeyDown={(e) => onKeyDown(i, e)}
            aria-label={`Chiffre ${i + 1}`}
            className="w-14 h-16 text-center text-2xl font-bold rounded-xl border-2 outline-none"
            style={{
              color: "var(--lj-text, var(--color-text-primary))",
              background: filled ? glow : surface,
              borderColor: filled ? primary : border,
              fontSize: 24,
            }}
          />
        );
      })}
    </div>
  );
}
