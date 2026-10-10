import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/use-auth';
import { profileForUser } from '@/auth/roles';
import HeroSearchBar from '@/espaces/joueur/components/hero/HeroSearchBar';
import { ThemeToggle } from '@/components/ThemeToggle';

/**
 * Bannière hero — vidéo sans flash poster.
 * Fond vert foncé pendant le chargement, fade-in à canplay.
 */
export const BannerVideoHeader = ({
  searchQuery = '',
  onSearchChange,
  onFilterClick,
  activeFilterCount = 0,
  onSearch,
  onFiltreClick,
  user: userProp,
}) => {
  const navigate = useNavigate();
  const { user: authUser, isAuthenticated } = useAuth();
  const user = userProp || authUser;
  const videoRef = useRef(null);
  const [videoReady, setVideoReady] = useState(false);

  const initials =
    `${(user?.prenom || '').trim().charAt(0)}${(user?.nom || '').trim().charAt(0)}`.toUpperCase() ||
    'TS';
  const photo = user?.photo_url || user?.photo_profil;

  const handleSearch = (value) => {
    onSearchChange?.(value);
    onSearch?.(value);
  };

  const handleFilter = () => {
    onFiltreClick?.();
    onFilterClick?.();
  };

  return (
    <div className="relative w-full mb-2 md:mb-4">
      <div
        className={[
          'relative w-full overflow-hidden',
          'h-[38vh] min-h-[280px] max-h-[440px]',
          'md:h-[300px] lg:h-[340px]',
          'rounded-none border-0 shadow-none m-0',
          'md:rounded-3xl md:border md:border-[var(--border)] md:shadow-[var(--shadow-lg)]',
        ].join(' ')}
        style={{ background: 'var(--color-primary-dark, #063D24)' }}
      >
        <div className="absolute inset-0 overflow-hidden" aria-hidden="true">
          <video
            ref={videoRef}
            autoPlay
            loop
            muted
            playsInline
            preload="auto"
            onCanPlay={() => {
              setVideoReady(true);
              if (videoRef.current) {
                videoRef.current.muted = true;
                void videoRef.current.play().catch(() => undefined);
              }
            }}
            style={{
              opacity: videoReady ? 1 : 0,
              transition: 'opacity 0.4s ease',
            }}
            className="absolute inset-0 h-full w-full object-cover"
          >
            <source src="/videos/terrainsn-hero.mp4" type="video/mp4" />
          </video>
        </div>

        <div
          className="absolute inset-0 z-10 pointer-events-none"
          style={{
            background:
              'linear-gradient(180deg, rgba(0,0,0,0.28) 0%, rgba(0,0,0,0.55) 55%, rgba(0,0,0,0.72) 100%)',
          }}
        />

        <header className="relative z-20 flex md:hidden items-center justify-between px-4 pt-[calc(0.75rem+env(safe-area-inset-top,0px))]">
          <span
            className="font-sans text-lg font-extrabold tracking-tight text-white"
            style={{ filter: 'drop-shadow(0 2px 4px rgba(0, 0, 0, 0.6))' }}
          >
            TERRAIN<span className="text-[var(--primary-light)]">.SN</span>
          </span>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <button
              type="button"
              onClick={() => {
                if (isAuthenticated) navigate(profileForUser(user));
                else navigate('/login');
              }}
              className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-white/25 bg-white/10 font-sans text-xs font-bold text-white backdrop-blur-md"
              aria-label={isAuthenticated ? 'Ouvrir le profil' : 'Se connecter'}
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
              filter: 'drop-shadow(0 2px 4px rgba(0, 0, 0, 0.6))',
            }}
          >
            Trouve ton terrain, réserve ton{' '}
            <span
              className="font-extrabold not-italic text-[var(--primary-light)]"
              style={{ fontFamily: 'inherit' }}
            >
              match.
            </span>
          </h1>
        </div>
      </div>

      <div className="relative z-20 px-4 sm:px-6 md:px-0 -mt-7 md:-mt-8 max-w-3xl md:mx-auto">
        <HeroSearchBar
          searchQuery={searchQuery}
          onSearchChange={handleSearch}
          onFilterClick={handleFilter}
          activeFilterCount={activeFilterCount}
        />
      </div>
    </div>
  );
};

export default BannerVideoHeader;
