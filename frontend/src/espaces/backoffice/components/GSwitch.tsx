type Props = {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
};

export function GSwitch({ checked, onChange, label }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className="g-switch"
      style={{ background: checked ? "var(--g-primary)" : "var(--g-border)" }}
    >
      <span className="g-switch-thumb" />
    </button>
  );
}
