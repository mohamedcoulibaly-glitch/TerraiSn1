import { useEffect, useRef } from "react";

/** Même source que le header joueur (`HeroVariants`). */
export default function LoginHeroVideo({ className = "" }: { className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.muted = true;
    void el.play().catch(() => {});
  }, []);

  return (
    <video
      ref={ref}
      autoPlay
      loop
      muted
      playsInline
      aria-hidden="true"
      className={`login-bg-video ${className}`.trim()}
      poster="/images/hero-placeholder.jpg"
    >
      <source src="/videos/terrainsn-hero.mp4" type="video/mp4" />
    </video>
  );
}
