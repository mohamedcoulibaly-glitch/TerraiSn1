/** Icônes Wave / Orange Money — carrés lisibles (évite le crop des logos panoramiques). */

type IconProps = {
  className?: string;
  title?: string;
  /** Masquer pour les lecteurs d’écran (ex. footer décoratif) */
  decorative?: boolean;
};

/** Marque Wave : fond bleu + pingouin simplifié (icône app). */
export function WaveIcon({ className = "w-5 h-5", title = "Wave", decorative }: IconProps) {
  return (
    <svg
      viewBox="0 0 40 40"
      className={className}
      role={decorative ? "presentation" : "img"}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : title}
      xmlns="http://www.w3.org/2000/svg"
    >
      {!decorative ? <title>{title}</title> : null}
      <rect width="40" height="40" rx="8" fill="#1DC8FF" />
      <ellipse cx="20" cy="23" rx="9" ry="10" fill="#111827" />
      <ellipse cx="20" cy="25" rx="5.5" ry="6.5" fill="#F8FAFC" />
      <path
        d="M11 20c-2.5 1-3.5 4-2.5 6.5"
        stroke="#111827"
        strokeWidth="2.4"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M29 18c2.2-.2 3.8 1.8 3.2 4.2"
        stroke="#111827"
        strokeWidth="2.4"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="20" cy="14" r="6.5" fill="#111827" />
      <circle cx="17.5" cy="13.5" r="1.35" fill="#F8FAFC" />
      <circle cx="22.5" cy="13.5" r="1.35" fill="#F8FAFC" />
      <path d="M18.5 16.2 L20 18.2 L21.5 16.2 Z" fill="#F97316" />
      <ellipse cx="16.5" cy="33.2" rx="2.4" ry="1.3" fill="#F97316" />
      <ellipse cx="23.5" cy="33.2" rx="2.4" ry="1.3" fill="#F97316" />
    </svg>
  );
}

/** Marque Orange Money : flèches croisées (symbole officiel simplifié). */
export function OrangeMoneyIcon({
  className = "w-5 h-5",
  title = "Orange Money",
  decorative,
}: IconProps) {
  return (
    <svg
      viewBox="0 0 40 40"
      className={className}
      role={decorative ? "presentation" : "img"}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : title}
      xmlns="http://www.w3.org/2000/svg"
    >
      {!decorative ? <title>{title}</title> : null}
      <rect width="40" height="40" rx="8" fill="#FFFFFF" stroke="#E5E7EB" strokeWidth="1" />
      {/* Flèche noire (haut-droite) */}
      <path
        d="M12 14h10v3.2H17.8L26 25.4l-2.3 2.3L15.5 19.5V24H12V14z"
        fill="#111827"
      />
      {/* Flèche orange (bas-gauche) */}
      <path
        d="M28 26H18v-3.2h4.2L14 14.6l2.3-2.3 8.2 8.2V16H28v10z"
        fill="#FF7900"
      />
    </svg>
  );
}
