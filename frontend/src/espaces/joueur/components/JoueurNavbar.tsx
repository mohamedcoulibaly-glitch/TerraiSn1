import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Calendar, LogOut } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

function initials(user: { prenom?: string; nom?: string } | null) {
  const p = (user?.prenom || "").trim();
  const n = (user?.nom || "").trim();
  if (p || n) {
    return `${p.charAt(0)}${n.charAt(0)}`.toUpperCase() || "TS";
  }
  return "TS";
}

/**
 * Navbar joueur — fond blanc, mobile-first (Phase 3 UI).
 */
export default function JoueurNavbar() {
  const { isAuthenticated, user, logout } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen]);

  return (
    <header className="fixed top-0 inset-x-0 z-40 h-14 bg-white border-b border-[var(--color-border)]">
      <div className="h-full max-w-screen-xl mx-auto px-4 flex items-center justify-between gap-3 relative">
        {/* Mobile : logo centré ; desktop : à gauche */}
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
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={() => setMenuOpen((o) => !o)}
                className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-[var(--color-primary)] text-white text-xs font-semibold"
                aria-expanded={menuOpen}
                aria-haspopup="menu"
                aria-label="Menu compte"
              >
                {initials(user)}
              </button>

              {menuOpen && (
                <div
                  role="menu"
                  className="absolute right-0 mt-2 w-52 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-white shadow-lg py-1.5 z-50"
                >
                  <button
                    type="button"
                    role="menuitem"
                    className="w-full flex items-center gap-2.5 px-4 min-h-[48px] text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-surface-2)]"
                    onClick={() => {
                      setMenuOpen(false);
                      navigate("/reservations");
                    }}
                  >
                    <Calendar className="w-4 h-4 text-[var(--color-text-secondary)]" />
                    Mes réservations
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="w-full flex items-center gap-2.5 px-4 min-h-[48px] text-sm text-[var(--color-danger)] hover:bg-[var(--color-surface-2)]"
                    onClick={() => {
                      setMenuOpen(false);
                      logout();
                      navigate("/");
                    }}
                  >
                    <LogOut className="w-4 h-4" />
                    Se déconnecter
                  </button>
                </div>
              )}
            </div>
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
