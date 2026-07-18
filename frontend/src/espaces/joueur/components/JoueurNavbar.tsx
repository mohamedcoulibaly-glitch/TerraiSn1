import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/use-auth";
import { profileForUser } from "@/auth/roles";

function initials(user: { prenom?: string; nom?: string } | null) {
  const p = (user?.prenom || "").trim();
  const n = (user?.nom || "").trim();
  return `${p.charAt(0)}${n.charAt(0)}`.toUpperCase() || "TS";
}

export default function JoueurNavbar() {
  const { isAuthenticated, user } = useAuth();
  const navigate = useNavigate();

  return (
    <header className="fixed top-0 inset-x-0 z-40 h-14 bg-white border-b border-[var(--color-border)]">
      <div className="h-full max-w-screen-xl mx-auto px-4 flex items-center justify-between gap-3 relative">
        <Link
          to="/"
          className="absolute left-1/2 -translate-x-1/2 sm:static sm:translate-x-0 flex items-center gap-2 min-w-0"
        >
          <span
            className="font-display font-semibold text-[15px] tracking-tight text-[var(--color-primary)]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            TerrainSN
          </span>
        </Link>

        <div className="ml-auto flex items-center">
          {isAuthenticated ? (
            <button
              type="button"
              onClick={() => navigate(profileForUser(user))}
              className="inline-flex items-center justify-center w-9 h-9 rounded-full overflow-hidden border-2 border-[var(--color-primary)] bg-[var(--color-primary)] text-white text-xs font-semibold"
              aria-label="Profil"
            >
              {user?.photo_url ? <img src={user.photo_url} alt="" className="w-full h-full object-cover" /> : initials(user)}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => navigate("/login")}
              className="inline-flex items-center justify-center min-h-[40px] px-4 rounded-[var(--radius-md)] border border-[var(--color-primary)] text-[var(--color-primary)] text-sm font-medium hover:bg-[color-mix(in_srgb,var(--color-primary)_8%,white)]"
            >
              Se connecter
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
