import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/use-auth";
import { profileForUser } from "@/auth/roles";
import HeroSearchBar from "@/espaces/joueur/components/hero/HeroSearchBar";
import { ThemeToggle } from "@/components/ThemeToggle";

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

export function HeroResponsive(props: HeroSharedProps) {
  const navigate = useNavigate();
  const { user, isAuthenticated, initials, photo } = useHeroUser(props.user);

  return (
    <div className="relative w-full mb-2 md:mb-3 md:mt-3">
      {/* Bloc vidéo agrandi */}
      <div className="relative w-full h-[35vh] min-h-[260px] max-h-[380px] md:h-[320px] md:max-h-none lg:h-[360px] overflow-hidden md:rounded-3xl md:border md:border-[var(--border)] md:shadow-[var(--shadow-lg)] bg-[var(--surface)]">
        <video
          autoPlay
          loop
          muted
          playsInline
          aria-hidden="true"
          className="absolute inset-0 w-full h-full object-cover object-center z-0"
          poster="/images/hero-placeholder.jpg"
        >
          <source src="/videos/terrainsn-hero.mp4" type="video/mp4" />
        </video>

        <div
          className="absolute inset-0 z-10 pointer-events-none"
          style={{
            background:
              "linear-gradient(180deg, rgba(0,0,0,0.3) 0%, rgba(0,0,0,0.65) 100%)",
          }}
        />

        <header className="relative z-20 flex md:hidden items-center justify-between px-4 pt-3">
          <span
            className="text-lg font-black tracking-tight text-white"
            style={{ filter: "drop-shadow(0 2px 4px rgba(0, 0, 0, 0.6))" }}
          >
            TERRAIN<span className="text-emerald-400">.SN</span>
          </span>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <button
              type="button"
              onClick={() => {
                if (isAuthenticated) navigate(profileForUser(user));
                else navigate("/login");
              }}
              className="w-9 h-9 rounded-full bg-white/10 backdrop-blur-md border border-white/25 flex items-center justify-center font-bold text-white text-xs overflow-hidden"
              aria-label="Profil"
            >
              {photo ? (
                <img src={photo} alt="Profil" className="w-full h-full rounded-full object-cover" />
              ) : (
                <span>{initials}</span>
              )}
            </button>
          </div>
        </header>

        {/* Titre — blanc + accent uniquement sur « match. » */}
        <div className="absolute inset-0 z-20 flex items-center px-5 md:px-8 lg:px-10 pointer-events-none">
          <h1
            className="text-2xl sm:text-3xl md:text-4xl lg:text-[2.75rem] font-extrabold text-white leading-tight max-w-xl"
            style={{ filter: "drop-shadow(0 2px 4px rgba(0, 0, 0, 0.6))" }}
          >
            Trouve ton terrain, réserve ton{" "}
            <span className="text-emerald-400 font-extrabold">match.</span>
          </h1>
        </div>
      </div>

      {/* Barre de recherche flottante — chevauche le bas du hero */}
      <div className="relative z-20 px-3 sm:px-4 md:px-6 -mt-7">
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
