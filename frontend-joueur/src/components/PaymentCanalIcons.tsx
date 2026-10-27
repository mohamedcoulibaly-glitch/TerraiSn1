/** Icônes Wave / Orange Money — carrés lisibles à petite taille (évite crop + collapse SVG). */

type IconProps = {
  className?: string;
  title?: string;
  /** Masquer pour les lecteurs d’écran (ex. footer décoratif) */
  decorative?: boolean;
};

const iconClass = (className: string) =>
  ["max-w-none shrink-0 block", className].filter(Boolean).join(" ");

/** Marque Wave : fond bleu + W blanc (lisible dès 16px). */
export function WaveIcon({ className = "w-5 h-5", title = "Wave", decorative }: IconProps) {
  return (
    <svg
      viewBox="0 0 40 40"
      width={20}
      height={20}
      className={iconClass(className)}
      role={decorative ? "presentation" : "img"}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : title}
      xmlns="http://www.w3.org/2000/svg"
    >
      {!decorative ? <title>{title}</title> : null}
      <rect width="40" height="40" rx="10" fill="#1DC8FF" />
      <path
        d="M9 26c2.2-6.5 5.2-10 9-10 2.4 0 3.8 1.6 5 4.2 1.2 2.6 2.2 3.8 4 3.8 1.6 0 2.8-.8 4-2.4"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="20" cy="12" r="3.2" fill="#FFFFFF" />
    </svg>
  );
}

/** Marque Orange Money : fond orange + flèches croisées blanches/noires. */
export function OrangeMoneyIcon({
  className = "w-5 h-5",
  title = "Orange Money",
  decorative,
}: IconProps) {
  return (
    <svg
      viewBox="0 0 40 40"
      width={20}
      height={20}
      className={iconClass(className)}
      role={decorative ? "presentation" : "img"}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : title}
      xmlns="http://www.w3.org/2000/svg"
    >
      {!decorative ? <title>{title}</title> : null}
      <rect width="40" height="40" rx="10" fill="#FF7900" />
      {/* Flèche noire ↗ */}
      <path d="M14 12h12v4H21l7 7-2.8 2.8-7-7V24h-4V12z" fill="#111827" />
      {/* Flèche blanche ↙ */}
      <path d="M26 28H14v-4h5l-7-7 2.8-2.8 7 7V16h4v12z" fill="#FFFFFF" />
    </svg>
  );
}
