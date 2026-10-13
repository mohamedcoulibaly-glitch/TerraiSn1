import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/use-auth";
import { AppRole, normalizeRole } from "@/auth/roles";
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
 * Protège une route pro selon le rôle (gerant / proprietaire / super_admin).
 * Non connecté / mauvais rôle → /login.
 */
export default function RoleGuard({ roles, children, requireAuth = true }: RoleGuardProps) {
  const { user, isAuthenticated, loading } = useAuth();
  const location = useLocation();

  if (loading) return <LoadingScreen />;

  if (requireAuth && !isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  const role = normalizeRole(user);
  if (!role || !roles.includes(role)) {
    // Joueur / mauvais rôle staff → page de connexion pro
    // (la page login propose de changer de compte)
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <>{children}</>;
}

/** Route exigeant une session pro (gérant / propriétaire / super admin). */
export function RequireAnyAuth({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated, loading } = useAuth();
  const location = useLocation();

  if (loading) return <LoadingScreen />;

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  const role = normalizeRole(user);
  if (!role || role === "joueur") {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <>{children}</>;
}
