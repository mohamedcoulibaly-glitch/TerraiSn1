import { useEffect } from "react";
import { createPortal } from "react-dom";

export type SaConfirmationVariante = "danger" | "warning" | "success" | "primary";

export type ConfirmationModalProps = {
  ouvert: boolean;
  titre: string;
  texte: string;
  labelConfirmer?: string;
  labelAnnuler?: string;
  variante?: SaConfirmationVariante;
  onConfirmer: () => void;
  onAnnuler: () => void;
  children?: React.ReactNode;
};

const CONFIRM_BG: Record<SaConfirmationVariante, string> = {
  danger: "var(--sa-danger)",
  warning: "var(--sa-warning)",
  success: "var(--sa-success)",
  primary: "var(--sa-primary)",
};

export function ConfirmationModal({
  ouvert,
  titre,
  texte,
  labelConfirmer = "Confirmer",
  labelAnnuler = "Annuler",
  variante = "danger",
  onConfirmer,
  onAnnuler,
  children,
}: ConfirmationModalProps) {
  useEffect(() => {
    if (!ouvert) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onAnnuler();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [ouvert, onAnnuler]);

  if (!ouvert) return null;

  return createPortal(
    <div className="superadmin-app fixed inset-0 z-[80] flex items-end md:items-center justify-center px-0 md:px-4">
      <button type="button" className="absolute inset-0" style={{ background: "rgba(10,22,40,0.45)" }} aria-label={labelAnnuler} onClick={onAnnuler} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="sa-confirm-title"
        className="relative w-full max-w-md rounded-t-2xl md:rounded-2xl p-5"
        style={{ background: "var(--sa-surface)", boxShadow: "var(--sa-shadow-md)" }}
      >
        <h2
          id="sa-confirm-title"
          className="text-lg font-bold"
          style={{ color: "var(--sa-text)", fontFamily: "var(--font-display)" }}
        >
          {titre}
        </h2>
        <p className="mt-2 text-sm whitespace-pre-line" style={{ color: "var(--sa-text-2)" }}>
          {texte}
        </p>
        {children ? <div className="mt-3">{children}</div> : null}
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onAnnuler}
            className="min-h-[48px] rounded-xl text-sm font-semibold"
            style={{ background: "transparent", color: "var(--sa-text-2)", border: "1.5px solid var(--sa-border)" }}
          >
            {labelAnnuler}
          </button>
          <button
            type="button"
            onClick={onConfirmer}
            className="min-h-[48px] rounded-xl text-sm font-semibold text-white"
            style={{ background: CONFIRM_BG[variante] }}
          >
            {labelConfirmer}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default ConfirmationModal;
