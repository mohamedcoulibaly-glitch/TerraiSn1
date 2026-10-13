import { useState, type HTMLAttributes, type ReactNode } from "react";

export interface FloatingInputProps {
  id: string;
  label: string;
  type?: string;
  inputMode?: HTMLAttributes<HTMLInputElement>["inputMode"];
  value: string;
  onChange: (v: string) => void;
  erreur?: string;
  succes?: boolean;
  iconeGauche?: ReactNode;
  iconeDroite?: ReactNode;
  onIconeDroiteClick?: () => void;
  disabled?: boolean;
  theme: "joueur" | "backoffice";
  autoComplete?: string;
  maxLength?: number;
  onFocus?: () => void;
  onBlur?: () => void;
}

export default function FloatingInput({
  id,
  label,
  type = "text",
  inputMode,
  value,
  onChange,
  erreur,
  succes,
  iconeGauche,
  iconeDroite,
  onIconeDroiteClick,
  disabled,
  theme,
  autoComplete,
  maxLength,
  onFocus,
  onBlur,
}: FloatingInputProps) {
  const [focused, setFocused] = useState(false);
  const errorColor = theme === "joueur" ? "var(--lj-error)" : "var(--lb-error)";
  const primary = theme === "joueur" ? "var(--lj-primary)" : "var(--lb-primary)";

  const stateClass = [
    focused ? "is-focus" : "",
    value ? "is-filled" : "",
    erreur ? "is-error" : "",
    succes && !erreur ? "is-success" : "",
    iconeGauche ? "has-left" : "",
    iconeDroite ? "has-right" : "",
    disabled ? "opacity-50 pointer-events-none" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="w-full">
      <div className={`input-float-wrapper ${stateClass}`}>
        {iconeGauche ? <span className="input-float-prefix">{iconeGauche}</span> : null}
        <input
          id={id}
          type={type}
          inputMode={inputMode}
          autoComplete={autoComplete}
          maxLength={maxLength}
          disabled={disabled}
          value={value}
          placeholder=" "
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => {
            setFocused(true);
            onFocus?.();
          }}
          onBlur={() => {
            setFocused(false);
            onBlur?.();
          }}
        />
        <label htmlFor={id}>{label}</label>
        {iconeDroite ? (
          <span className="input-float-suffix" style={succes && !onIconeDroiteClick ? { color: primary } : undefined}>
            {onIconeDroiteClick ? (
              <button type="button" onClick={onIconeDroiteClick} tabIndex={-1} aria-label="Afficher ou masquer">
                {iconeDroite}
              </button>
            ) : (
              iconeDroite
            )}
          </span>
        ) : null}
      </div>
      {erreur ? (
        <p className="mt-1.5 text-[13px] animate-[login-fade-in_0.2s_ease]" style={{ color: errorColor }}>
          {erreur}
        </p>
      ) : null}
    </div>
  );
}
