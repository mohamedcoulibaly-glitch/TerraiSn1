import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/use-auth";
import { normalizeRole } from "@/auth/roles";
import SkeletonSession from "@/components/skeletons/SkeletonSession";

function LoadingScreen() {
  return <SkeletonSession />;
}

/**
 * Espace joueur : visiteurs + joueurs.
 * Un compte non-joueur ne devrait jamais avoir de session ici (rejeté dans use-auth) ;
 * par sécurité on l'envoie vers /login.
 */
export function JoueurSpaceGuard({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated, loading } = useAuth();

  if (loading) return <LoadingScreen />;

  if (isAuthenticated) {
    const role = normalizeRole(user);
    if (role && role !== "joueur") {
      return <Navigate to="/login" replace />;
    }
  }

  return <>{children}</>;
}

/**
 * Routes joueur qui exigent une connexion (paiement, réservations, profil…).
 * Non connecté → /login avec retour après auth.
 */
export function RequireJoueurAuth({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated, loading } = useAuth();
  const location = useLocation();

  if (loading) return <LoadingScreen />;

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  const role = normalizeRole(user);
  if (role && role !== "joueur") {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

export function RequireAnyAuth({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loading } = useAuth();
  const location = useLocation();

  if (loading) return <LoadingScreen />;

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <>{children}</>;
}
