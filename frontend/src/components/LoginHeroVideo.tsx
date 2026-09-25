import HeroVideo from "@/components/HeroVideo";

/** Même source que le header joueur (`HeroVariants`). */
export default function LoginHeroVideo({ className = "" }: { className?: string }) {
  return <HeroVideo className={`login-bg-video ${className}`.trim()} />;
}
