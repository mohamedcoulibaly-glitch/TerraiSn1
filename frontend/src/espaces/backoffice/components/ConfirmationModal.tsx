import { useEffect } from "react";
import { createPortal } from "react-dom";

export type ConfirmationVariante = "danger" | "warning";

export type ConfirmationModalProps = {
  ouvert: boolean;
  titre: string;
  texte: string;
  labelConfirmer?: string;
  labelAnnuler?: string;
  variante?: ConfirmationVariante;
  onConfirmer: () => void;
  onAnnuler: () => void;
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

  const confirmBg = variante === "warning" ? "var(--g-warning)" : "var(--g-danger)";

  return createPortal(
    <div className="gerant-app fixed inset-0 z-[80] flex items-end md:items-center justify-center px-0 md:px-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/45"
        aria-label={labelAnnuler}
        onClick={onAnnuler}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="g-confirm-title"
        aria-describedby="g-confirm-text"
        className="g-confirm-sheet relative w-full max-w-md rounded-t-2xl md:rounded-2xl p-5 pb-safe"
        style={{ background: "var(--g-surface)", boxShadow: "var(--g-shadow-md)" }}
      >
        <div className="flex justify-center md:hidden pb-3">
          <span className="w-10 h-1 rounded-full" style={{ background: "var(--g-border)" }} />
        </div>
        <h2
          id="g-confirm-title"
          className="text-lg font-bold"
          style={{ color: "var(--g-text)", fontFamily: "var(--font-display)" }}
        >
          {titre}
        </h2>
        <p
          id="g-confirm-text"
          className="mt-2 text-sm whitespace-pre-line"
          style={{ color: "var(--g-text-2)" }}
        >
          {texte}
        </p>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onAnnuler}
            className="min-h-[48px] rounded-xl text-sm font-semibold btn-press"
            style={{
              background: "transparent",
              color: "var(--g-text-2)",
              border: "1.5px solid var(--g-border)",
            }}
          >
            {labelAnnuler}
          </button>
          <button
            type="button"
            onClick={onConfirmer}
            className="min-h-[48px] rounded-xl text-sm font-semibold text-white btn-press"
            style={{ background: confirmBg }}
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
