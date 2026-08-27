import { useEffect, useRef, useState } from "react";

type HeroVideoProps = {
  className?: string;
  /** Fond affiché tant que la vidéo n’est pas prête (évite le flash du poster). */
  fallbackClassName?: string;
};

/**
 * Vidéo hero sans flash du poster : fond neutre → fade-in dès que la 1ʳᵉ frame est prête.
 */
export default function HeroVideo({
  className = "",
  fallbackClassName = "bg-[#0B1F17]",
}: HeroVideoProps) {
  const ref = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const markReady = () => {
      setReady(true);
      el.muted = true;
      void el.play().catch(() => undefined);
    };

    if (el.readyState >= 2) {
      markReady();
      return;
    }

    el.addEventListener("loadeddata", markReady);
    el.addEventListener("canplay", markReady);
    return () => {
      el.removeEventListener("loadeddata", markReady);
      el.removeEventListener("canplay", markReady);
    };
  }, []);

  return (
    <div className={`absolute inset-0 overflow-hidden ${fallbackClassName}`} aria-hidden="true">
      <video
        ref={ref}
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
        className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${
          ready ? "opacity-100" : "opacity-0"
        } ${className}`.trim()}
      >
        <source src="/videos/terrainsn-hero.mp4" type="video/mp4" />
      </video>
    </div>
  );
}
