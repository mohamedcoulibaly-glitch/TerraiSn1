/** Icônes Wave / Orange Money — assets marque (carré, object-position pour le logo). */

import waveAsset from "@/assets/wave-banque-en-ligne-au-senegal-pour-paiement-transfert-argents.jpg";
import omAsset from "@/assets/images.png";

type IconProps = {
  className?: string;
  title?: string;
  /** Masquer pour les lecteurs d’écran (ex. footer décoratif) */
  decorative?: boolean;
};

function CanalImg({
  src,
  className,
  title,
  decorative,
  objectPosition,
}: IconProps & { src: string; objectPosition: string }) {
  return (
    <img
      src={src}
      alt={decorative ? "" : title}
      title={decorative ? undefined : title}
      aria-hidden={decorative || undefined}
      width={24}
      height={24}
      decoding="async"
      className={`shrink-0 rounded-md object-cover ${className || "w-6 h-6"}`}
      style={{ objectPosition }}
    />
  );
}

/** Marque Wave : pingouin (partie gauche du logo panoramique). */
export function WaveIcon({ className = "w-6 h-6", title = "Wave", decorative }: IconProps) {
  return (
    <CanalImg
      src={waveAsset}
      className={className}
      title={title}
      decorative={decorative}
      objectPosition="left center"
    />
  );
}

/** Marque Orange Money : flèches (partie gauche du wordmark). */
export function OrangeMoneyIcon({
  className = "w-6 h-6",
  title = "Orange Money",
  decorative,
}: IconProps) {
  return (
    <CanalImg
      src={omAsset}
      className={className}
      title={title}
      decorative={decorative}
      objectPosition="left center"
    />
  );
}
