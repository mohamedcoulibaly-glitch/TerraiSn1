import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export type SaModalProps = {
  ouvert: boolean;
  titre: string;
  onFermer: () => void;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
};

export function SaModal({ ouvert, titre, onFermer, children, footer, className }: SaModalProps) {
  useEffect(() => {
    if (!ouvert) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onFermer();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [ouvert, onFermer]);

  if (!ouvert) return null;

  return createPortal(
    <div className="superadmin-app fixed inset-0 z-[80] flex items-end md:items-center justify-center px-0 md:px-4">
      <button type="button" className="absolute inset-0 backdrop-blur-sm" style={{ background: "rgba(0,0,0,0.4)" }} aria-label="Fermer" onClick={onFermer} />
      <div
        role="dialog"
        className={`relative w-full max-w-lg rounded-[var(--sa-radius-xl)] max-h-[92vh] overflow-y-auto ${className || ""}`}
        style={{ background: "var(--sa-surface)", boxShadow: "var(--sa-shadow-xl)", animation: "sa-modal-in 200ms ease" }}
      >
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid var(--sa-border)" }}>
          <h2 className="text-[16px] font-semibold" style={{ color: "var(--sa-text)", fontFamily: "var(--sa-font-display)" }}>{titre}</h2>
          <button type="button" className="sa-btn sa-btn-ghost sa-btn-sm" onClick={onFermer} aria-label="Fermer"><X size={16} /></button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer ? (
          <div className="px-5 py-3 flex justify-end gap-2" style={{ borderTop: "1px solid var(--sa-border)", background: "var(--sa-surface-2)" }}>
            {footer}
          </div>
        ) : null}
      </div>
      <style>{`@keyframes sa-modal-in { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }`}</style>
    </div>,
    document.body,
  );
}

export default SaModal;
