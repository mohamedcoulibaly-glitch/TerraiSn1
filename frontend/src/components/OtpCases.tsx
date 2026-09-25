import { useRef, type ClipboardEvent, type KeyboardEvent } from "react";

interface OtpCasesProps {
  value: string;
  onChange: (v: string) => void;
  theme: "joueur" | "backoffice";
  disabled?: boolean;
}

export default function OtpCases({ value, onChange, theme, disabled }: OtpCasesProps) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const primary = theme === "joueur" ? "var(--lj-primary)" : "var(--lb-primary)";
  const glow = theme === "joueur" ? "var(--lj-primary-glow)" : "var(--lb-primary-glow)";
  const border = theme === "joueur" ? "var(--lj-border)" : "var(--lb-border)";

  const setDigit = (index: number, raw: string) => {
    const digit = raw.replace(/\D/g, "").slice(-1);
    const arr = Array.from({ length: 6 }, (_, i) => value[i] || "");
    arr[index] = digit;
    onChange(arr.join(""));
    if (digit && index < 5) refs.current[index + 1]?.focus();
  };

  const onKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !value[index] && index > 0) {
      refs.current[index - 1]?.focus();
    }
  };

  const onPaste = (e: ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (!pasted) return;
    onChange(pasted);
    refs.current[Math.min(pasted.length, 5)]?.focus();
  };

  return (
    <div className="login-otp-row" onPaste={onPaste}>
      {Array.from({ length: 6 }).map((_, i) => {
        const filled = !!value[i];
        return (
          <input
            key={i}
            ref={(el) => {
              refs.current[i] = el;
            }}
            inputMode="numeric"
            autoComplete={i === 0 ? "one-time-code" : "off"}
            maxLength={1}
            disabled={disabled}
            value={value[i] || ""}
            onChange={(e) => setDigit(i, e.target.value)}
            onKeyDown={(e) => onKeyDown(i, e)}
            aria-label={`Chiffre ${i + 1}`}
            className="login-otp-cell"
            style={{
              color: primary,
              background: filled ? glow : "var(--surface-2)",
              border: `1px solid ${filled ? primary : border}`,
            }}
          />
        );
      })}
    </div>
  );
}
