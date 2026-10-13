import * as React from "react";

/** Aligné Tailwind : md = 768px, lg = 1024px */
export const BREAKPOINTS = {
  md: 768,
  lg: 1024,
} as const;

export type DeviceType = "mobile" | "tablet" | "desktop";

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = React.useState(false);

  React.useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

/**
 * Device pour l'espace joueur :
 * - mobile  < 768px
 * - tablet  768–1023px
 * - desktop ≥ 1024px
 */
export function useDevice(): DeviceType {
  const isDesktop = useMediaQuery(`(min-width: ${BREAKPOINTS.lg}px)`);
  const isTablet = useMediaQuery(
    `(min-width: ${BREAKPOINTS.md}px) and (max-width: ${BREAKPOINTS.lg - 1}px)`
  );

  if (isDesktop) return "desktop";
  if (isTablet) return "tablet";
  return "mobile";
}

export function useIsDesktop() {
  return useMediaQuery(`(min-width: ${BREAKPOINTS.lg}px)`);
}

export function useIsMobileOnly() {
  return useMediaQuery(`(max-width: ${BREAKPOINTS.md - 1}px)`);
}
