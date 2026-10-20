import { useRef, type ReactNode, type TouchEvent } from "react";
import { X } from "lucide-react";

type BottomSheetProps = {
  ouvert: boolean;
  onFermer: () => void;
  titre?: string;
  children: ReactNode;
  hauteurMax?: string;
};

/**
 * Bottom sheet mobile : le swipe vers le bas (> 120px) ferme TOUJOURS
 * le sheet, quelle que soit la vitesse du geste. Fermeture aussi au
 * tap sur l'overlay ou sur le bouton X.
 */
export const BottomSheet = ({
  ouvert,
  onFermer,
  titre,
  children,
  hauteurMax = "90vh",
}: BottomSheetProps) => {
  const sheetRef = useRef<HTMLDivElement>(null);
  const startY = useRef(0);
  const isDragging = useRef(false);

  const handleTouchStart = (e: TouchEvent) => {
    startY.current = e.touches[0].clientY;
    isDragging.current = true;
  };

  const handleTouchMove = (e: TouchEvent) => {
    if (!isDragging.current || !sheetRef.current) return;
    const deltaY = e.touches[0].clientY - startY.current;
    if (deltaY > 0) {
      sheetRef.current.style.transform = `translateY(${deltaY}px)`;
      sheetRef.current.style.transition = "none";
    }
  };

  const handleTouchEnd = (e: TouchEvent) => {
    if (!isDragging.current || !sheetRef.current) return;
    isDragging.current = false;
    const deltaY = e.changedTouches[0].clientY - startY.current;
    if (deltaY > 120) {
      onFermer();
    } else {
      sheetRef.current.style.transform = "translateY(0)";
      sheetRef.current.style.transition = "transform 0.3s ease";
    }
  };

  if (!ouvert) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-50"
        style={{ background: "rgba(0,0,0,0.5)" }}
        onClick={onFermer}
        aria-hidden
      />
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={titre}
        className="fixed bottom-0 left-0 right-0 z-50 rounded-t-3xl no-overscroll"
        style={{
          background: "var(--surface)",
          maxHeight: hauteurMax,
          transform: "translateY(0)",
          transition: "transform 0.3s ease",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div className="flex justify-center pt-3 pb-2">
          <div
            className="w-10 h-1 rounded-full"
            style={{ background: "var(--color-border)" }}
          />
        </div>

        {titre && (
          <div className="px-5 pb-3 flex items-center justify-between">
            <h2 className="font-semibold text-base" style={{ color: "var(--color-text-primary)" }}>
              {titre}
            </h2>
            <button
              type="button"
              onClick={onFermer}
              className="btn-press p-2 -mr-2"
              style={{ minWidth: "44px", minHeight: "44px" }}
              aria-label="Fermer"
            >
              <X className="w-5 h-5" style={{ color: "var(--color-text-muted)" }} />
            </button>
          </div>
        )}

        <div className="overflow-y-auto px-5 pb-6" style={{ maxHeight: `calc(${hauteurMax} - 80px)` }}>
          {children}
        </div>
      </div>
    </>
  );
};

export default BottomSheet;
