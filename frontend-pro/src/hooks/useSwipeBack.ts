import { useEffect, useRef } from "react";

/**
 * Swipe retour : glisser depuis le bord gauche de l'écran (iOS + Android).
 * Ne se déclenche que si le geste démarre à moins de 30px du bord,
 * est horizontal (> seuil) et peu vertical (< 80px).
 */
export function useSwipeBack(onBack: () => void, threshold = 50) {
  const startX = useRef(0);
  const startY = useRef(0);
  const isSwiping = useRef(false);
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  useEffect(() => {
    const handleTouchStart = (e: TouchEvent) => {
      startX.current = e.touches[0].clientX;
      startY.current = e.touches[0].clientY;
      isSwiping.current = startX.current < 30; // seulement depuis le bord gauche
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (!isSwiping.current) return;
      const deltaX = e.changedTouches[0].clientX - startX.current;
      const deltaY = Math.abs(e.changedTouches[0].clientY - startY.current);
      if (deltaX > threshold && deltaY < 80) {
        onBackRef.current();
      }
      isSwiping.current = false;
    };

    document.addEventListener("touchstart", handleTouchStart, { passive: true });
    document.addEventListener("touchend", handleTouchEnd, { passive: true });
    return () => {
      document.removeEventListener("touchstart", handleTouchStart);
      document.removeEventListener("touchend", handleTouchEnd);
    };
  }, [threshold]);
}
