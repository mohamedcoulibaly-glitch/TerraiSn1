import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/use-auth";
import { AppRole, homeForUser, normalizeRole } from "@/auth/roles";
import SkeletonSession from "@/components/skeletons/SkeletonSession";

interface RoleGuardProps {
  roles: AppRole[];
  children: React.ReactNode;
  requireAuth?: boolean;
}

function LoadingScreen() {
  return <SkeletonSession />;
}

/**
 * Protège une route backoffice selon le rôle.
 * Non connecté / mauvais rôle → /backoffice/login (pas l'espace joueur).
 */
export default function RoleGuard({ roles, children, requireAuth = true }: RoleGuardProps) {
  const { user, isAuthenticated, loading } = useAuth();
  const location = useLocation();

  if (loading) return <LoadingScreen />;

  if (requireAuth && !isAuthenticated) {
    return <Navigate to="/backoffice/login" replace state={{ from: location }} />;
  }

  const role = normalizeRole(user);
  if (!role || !roles.includes(role)) {
    // Joueur / non connecté / mauvais rôle staff → login admin
    // (évite de renvoyer un superadmin vers /backoffice/admin quand
    // on vise proprio/gérant : la page login propose de changer de compte)
    return <Navigate to="/backoffice/login" replace state={{ from: location }} />;
  }

  return <>{children}</>;
}

/**
 * Espace joueur : visiteurs + joueurs.
 * Staff backoffice → leur dashboard.
 */
export function JoueurSpaceGuard({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated, loading } = useAuth();

  if (loading) return <LoadingScreen />;

  if (isAuthenticated) {
    const role = normalizeRole(user);
    if (role && role !== "joueur") {
      return <Navigate to={homeForUser(user)} replace />;
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
    return <Navigate to={homeForUser(user)} replace />;
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
