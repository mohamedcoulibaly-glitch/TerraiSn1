import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/use-auth";
import { profileForUser } from "@/auth/roles";
import HeroSearchBar from "@/espaces/joueur/components/hero/HeroSearchBar";
import { ThemeToggle } from "@/components/ThemeToggle";
import HeroVideo from "@/components/HeroVideo";

export type HeroSharedProps = {
  searchQuery?: string;
  onSearchChange?: (value: string) => void;
  onFilterClick?: () => void;
  activeFilterCount?: number;
  user?: any;
};

function useHeroUser(userProp?: any) {
  const { user: authUser, isAuthenticated } = useAuth();
  const user = userProp || authUser;
  const initials =
    `${(user?.prenom || "").trim().charAt(0)}${(user?.nom || "").trim().charAt(0)}`.toUpperCase() ||
    "TS";
  const photo = user?.photo_url || user?.photo_profil;
  return { user, isAuthenticated, initials, photo };
}

/**
 * Header Plein Écran / Bleed — vidéo collée aux bords gauche, droit et haut (PWA native).
 * Desktop (md+) : légèrement contenu sous la navbar, coins arrondis.
 */
export function HeroResponsive(props: HeroSharedProps) {
  const navigate = useNavigate();
  const { user, isAuthenticated, initials, photo } = useHeroUser(props.user);

  return (
    <div className="relative w-full mb-2 md:mb-4">
      {/* Mobile : edge-to-edge | Desktop : carte dans le flux */}
      <div
        className={[
          "relative w-full overflow-hidden bg-[#0B1F17]",
          "h-[38vh] min-h-[280px] max-h-[440px]",
          "md:h-[300px] lg:h-[340px]",
          /* Bleed mobile — aucun rayon / bordure / marge */
          "rounded-none border-0 shadow-none m-0",
          /* Desktop — immersion adoucie sous la navbar */
          "md:rounded-3xl md:border md:border-[var(--border)] md:shadow-[var(--shadow-lg)]",
        ].join(" ")}
      >
        <HeroVideo />

        <div
          className="absolute inset-0 z-10 pointer-events-none"
          style={{
            background:
              "linear-gradient(180deg, rgba(0,0,0,0.28) 0%, rgba(0,0,0,0.55) 55%, rgba(0,0,0,0.72) 100%)",
          }}
        />

        <header className="relative z-20 flex md:hidden items-center justify-between px-4 pt-[calc(0.75rem+env(safe-area-inset-top,0px))]">
          <span
            className="font-sans text-lg font-extrabold tracking-tight text-white"
            style={{ filter: "drop-shadow(0 2px 4px rgba(0, 0, 0, 0.6))" }}
          >
            TERRAIN<span className="text-[var(--primary-light)]">.SN</span>
          </span>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <button
              type="button"
              onClick={() => {
                if (isAuthenticated) navigate(profileForUser(user));
                else navigate("/login");
              }}
              className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-white/25 bg-white/10 font-sans text-xs font-bold text-white backdrop-blur-md"
              aria-label={isAuthenticated ? "Ouvrir le profil" : "Se connecter"}
            >
              {photo ? (
                <img src={photo} alt="Profil" className="w-full h-full rounded-full object-cover" />
              ) : (
                <span>{initials}</span>
              )}
            </button>
          </div>
        </header>

        <div className="pointer-events-none absolute inset-0 z-20 flex items-end md:items-center px-5 pb-14 md:pb-0 md:px-8 lg:px-10">
          <h1
            className="max-w-xl font-sans text-2xl font-extrabold not-italic leading-tight tracking-tight text-white sm:text-3xl md:text-4xl lg:text-[2.75rem]"
            style={{
              fontFamily: "'Plus Jakarta Sans', sans-serif",
              filter: "drop-shadow(0 2px 4px rgba(0, 0, 0, 0.6))",
            }}
          >
            Trouve ton terrain, réserve ton{" "}
            <span
              className="font-extrabold not-italic text-[var(--primary-light)]"
              style={{ fontFamily: "inherit" }}
            >
              match.
            </span>
          </h1>
        </div>
      </div>

      {/* Recherche flottante — chevauche le bas du hero */}
      <div className="relative z-20 px-4 sm:px-6 md:px-0 -mt-7 md:-mt-8 max-w-3xl md:mx-auto">
        <HeroSearchBar
          searchQuery={props.searchQuery}
          onSearchChange={props.onSearchChange}
          onFilterClick={props.onFilterClick}
          activeFilterCount={props.activeFilterCount}
        />
      </div>
    </div>
  );
}

export const HeroMobile = HeroResponsive;
export const HeroTablet = () => null;
export const HeroDesktop = () => null;
