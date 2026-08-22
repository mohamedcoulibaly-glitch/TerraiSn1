export interface BoutonSoumettreProps {
  label: string;
  labelLoading: string;
  loading: boolean;
  disabled?: boolean;
  theme: "joueur" | "backoffice";
  onClick: () => void;
  type?: "button" | "submit";
}

export default function BoutonSoumettre({
  label,
  labelLoading,
  loading,
  disabled,
  theme,
  onClick,
  type = "submit",
}: BoutonSoumettreProps) {
  const primary = theme === "joueur" ? "var(--lj-primary)" : "var(--lb-primary)";
  const primaryDark = theme === "joueur" ? "var(--lj-primary-dark)" : "var(--lb-primary-dark)";
  const isDisabled = disabled || loading;

  return (
    <button
      type={type}
      disabled={isDisabled}
      onClick={(e) => {
        if (loading) {
          e.preventDefault();
          return;
        }
        if (type === "button") onClick();
      }}
      className="login-submit w-full h-[52px] rounded-[14px] text-white text-base font-semibold inline-flex items-center justify-center gap-2 transition-transform duration-150 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
      style={{ background: isDisabled && !loading ? primary : primary }}
      onMouseDown={(e) => {
        if (!isDisabled) (e.currentTarget as HTMLButtonElement).style.background = primaryDark;
      }}
      onMouseUp={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = primary;
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = primary;
      }}
    >
      {loading ? (
        <>
          <span
            className="inline-block w-[18px] h-[18px] rounded-full border-2 border-white/40 border-t-white animate-spin"
            aria-hidden
          />
          {labelLoading}
        </>
      ) : (
        label
      )}
    </button>
  );
}
