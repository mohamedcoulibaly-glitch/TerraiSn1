import { lazy, Suspense, type LazyExoticComponent, type ComponentType } from "react";
import { Navigate, Route, Routes, useParams } from "react-router-dom";
import RoleGuard, { JoueurSpaceGuard, RequireAnyAuth, RequireJoueurAuth } from "@/auth/RoleGuard";
import JoueurLayout from "@/espaces/joueur/layout/JoueurLayout";
import BackofficeLayout from "@/espaces/backoffice/layout/BackofficeLayout";
import { FieldGridSkeleton } from "@/components/skeletons/TerrainSkeletons";
import { profileForUser } from "@/auth/roles";
import { useAuth } from "@/hooks/use-auth";

const PageLoader = () => (
  <div className="page-container responsive-padding py-8">
    <FieldGridSkeleton count={3} />
  </div>
);

const withSuspense = (Component: LazyExoticComponent<ComponentType>) => (
  <Suspense fallback={<PageLoader />}>
    <Component />
  </Suspense>
);

const LoginPage = lazy(() => import("@/auth/LoginPage"));
const BackofficeLoginPage = lazy(() => import("@/auth/BackofficeLoginPage"));
const Accueil = lazy(() => import("@/espaces/joueur/pages/Accueil"));
const RechercheTerrain = lazy(() => import("@/espaces/joueur/pages/RechercheTerrain"));
const FicheTerrain = lazy(() => import("@/espaces/joueur/pages/FicheTerrain"));
const Reservation = lazy(() => import("@/espaces/joueur/pages/Reservation"));
const MockPayment = lazy(() => import("@/espaces/joueur/pages/MockPayment"));
const Confirmation = lazy(() => import("@/espaces/joueur/pages/Confirmation"));
const MesReservations = lazy(() => import("@/espaces/joueur/pages/MesReservations"));
const ReservationSuccess = lazy(() => import("@/espaces/joueur/pages/ReservationSuccess"));
const ReservationCancelled = lazy(() => import("@/espaces/joueur/pages/ReservationCancelled"));
const ProfilJoueur = lazy(() => import("@/espaces/profil/ProfilJoueur"));
const ProfilGerant = lazy(() => import("@/espaces/profil/ProfilGerant"));
const ProfilProprietaire = lazy(() => import("@/espaces/profil/ProfilProprietaire"));
const ProfilAdmin = lazy(() => import("@/espaces/profil/ProfilAdmin"));
const ProfilNotifications = lazy(() => import("@/espaces/joueur/pages/ProfilNotifications"));
const ProfilSecurite = lazy(() => import("@/espaces/joueur/pages/ProfilSecurite"));
const ProfilAide = lazy(() => import("@/espaces/joueur/pages/ProfilAide"));
const ChangePassword = lazy(() => import("@/espaces/joueur/pages/ChangePassword"));
const NotFound = lazy(() => import("@/espaces/joueur/pages/NotFound"));

const SuperAdminDashboard = lazy(() => import("@/espaces/backoffice/pages/superadmin/Dashboard"));
const GestionTerrains = lazy(() => import("@/espaces/backoffice/pages/superadmin/GestionTerrains"));
const GestionUtilisateurs = lazy(() => import("@/espaces/backoffice/pages/superadmin/GestionUtilisateurs"));
const RevenusAdmin = lazy(() => import("@/espaces/backoffice/pages/superadmin/Revenus"));
const AbonnementsAdmin = lazy(() => import("@/espaces/backoffice/pages/superadmin/Abonnements"));
const GerantDashboard = lazy(() => import("@/espaces/backoffice/pages/gerant/Dashboard"));
const GerantJoueurs = lazy(() => import("@/espaces/backoffice/pages/gerant/JoueursReservations"));
const DetailReservationGerant = lazy(() => import("@/espaces/backoffice/pages/gerant/DetailReservation"));
const FinancesGerant = lazy(() => import("@/espaces/backoffice/pages/gerant/Finances"));
const ParametresGerant = lazy(() => import("@/espaces/backoffice/pages/gerant/Parametres"));
const ProprietaireDashboard = lazy(() => import("@/espaces/backoffice/pages/proprietaire/Dashboard"));
const MesRevenus = lazy(() => import("@/espaces/backoffice/pages/proprietaire/MesRevenus"));
const TerrainDetail = lazy(() => import("@/espaces/backoffice/pages/proprietaire/TerrainDetail"));
const SanteProprietaire = lazy(() => import("@/espaces/backoffice/pages/proprietaire/Sante"));

function RedirectProprietaireTerrain() {
  const { id } = useParams();
  return <Navigate to={`/backoffice/proprietaire/terrain/${id}`} replace />;
}

function RedirectProfilByRole() {
  const { user } = useAuth();
  return <Navigate to={profileForUser(user)} replace />;
}

export default function AppRouter() {
  return (
    <Routes>
      <Route path="/login" element={withSuspense(LoginPage)} />
      <Route path="/connexion" element={<Navigate to="/login" replace />} />
      <Route path="/changer-mot-de-passe" element={withSuspense(ChangePassword)} />
      <Route path="/backoffice/login" element={withSuspense(BackofficeLoginPage)} />
      <Route path="/profil" element={<RequireAnyAuth><RedirectProfilByRole /></RequireAnyAuth>} />
      <Route path="/profil/joueur" element={<RequireJoueurAuth>{withSuspense(ProfilJoueur)}</RequireJoueurAuth>} />
      <Route path="/profil/gerant" element={<RoleGuard roles={["gerant"]}>{withSuspense(ProfilGerant)}</RoleGuard>} />
      <Route path="/profil/proprietaire" element={<RoleGuard roles={["proprietaire"]}>{withSuspense(ProfilProprietaire)}</RoleGuard>} />
      <Route path="/profil/admin" element={<RoleGuard roles={["super_admin"]}>{withSuspense(ProfilAdmin)}</RoleGuard>} />

      <Route
        element={
          <JoueurSpaceGuard>
            <JoueurLayout />
          </JoueurSpaceGuard>
        }
      >
        <Route path="/" element={withSuspense(Accueil)} />
        <Route path="/explorer" element={withSuspense(RechercheTerrain)} />
        <Route path="/terrain/:id" element={withSuspense(FicheTerrain)} />
        <Route path="/paiement/:id" element={<RequireJoueurAuth>{withSuspense(Reservation)}</RequireJoueurAuth>} />
        <Route path="/paiement/mock" element={<RequireJoueurAuth>{withSuspense(MockPayment)}</RequireJoueurAuth>} />
        <Route path="/simulation/paiement" element={<RequireJoueurAuth>{withSuspense(MockPayment)}</RequireJoueurAuth>} />
        <Route path="/reservations" element={<RequireJoueurAuth>{withSuspense(MesReservations)}</RequireJoueurAuth>} />
        <Route path="/reservation/confirmation" element={<RequireJoueurAuth>{withSuspense(Confirmation)}</RequireJoueurAuth>} />
        <Route path="/reservation/succes" element={<RequireJoueurAuth>{withSuspense(ReservationSuccess)}</RequireJoueurAuth>} />
        <Route path="/reservation/annule" element={<RequireJoueurAuth>{withSuspense(ReservationCancelled)}</RequireJoueurAuth>} />
        <Route path="/profil/notifications" element={<RequireJoueurAuth>{withSuspense(ProfilNotifications)}</RequireJoueurAuth>} />
        <Route path="/profil/securite" element={<RequireJoueurAuth>{withSuspense(ProfilSecurite)}</RequireJoueurAuth>} />
        <Route path="/profil/aide" element={<RequireJoueurAuth>{withSuspense(ProfilAide)}</RequireJoueurAuth>} />
        <Route path="/profil/modifier" element={<Navigate to="/profil" replace />} />
      </Route>

      <Route
        path="/backoffice"
        element={
          <RoleGuard roles={["super_admin", "gerant", "proprietaire"]}>
            <BackofficeLayout />
          </RoleGuard>
        }
      >
        <Route path="admin" element={<RoleGuard roles={["super_admin"]}>{withSuspense(SuperAdminDashboard)}</RoleGuard>} />
        <Route path="admin/terrains" element={<RoleGuard roles={["super_admin"]}>{withSuspense(GestionTerrains)}</RoleGuard>} />
        <Route path="admin/utilisateurs" element={<RoleGuard roles={["super_admin"]}>{withSuspense(GestionUtilisateurs)}</RoleGuard>} />
        <Route path="admin/revenus" element={<RoleGuard roles={["super_admin"]}>{withSuspense(RevenusAdmin)}</RoleGuard>} />
        <Route path="admin/abonnements" element={<RoleGuard roles={["super_admin"]}>{withSuspense(AbonnementsAdmin)}</RoleGuard>} />
        <Route path="admin/profil" element={<Navigate to="/profil" replace />} />
        <Route path="gerant" element={<RoleGuard roles={["gerant"]}>{withSuspense(GerantDashboard)}</RoleGuard>} />
        <Route path="gerant/joueurs" element={<RoleGuard roles={["gerant"]}>{withSuspense(GerantJoueurs)}</RoleGuard>} />
        <Route path="gerant/joueurs/:id" element={<RoleGuard roles={["gerant"]}>{withSuspense(GerantJoueurs)}</RoleGuard>} />
        <Route path="gerant/finances" element={<RoleGuard roles={["gerant"]}>{withSuspense(FinancesGerant)}</RoleGuard>} />
        <Route path="gerant/parametres" element={<RoleGuard roles={["gerant"]}>{withSuspense(ParametresGerant)}</RoleGuard>} />
        <Route path="gerant/reservations/:id" element={<RoleGuard roles={["gerant"]}>{withSuspense(DetailReservationGerant)}</RoleGuard>} />
        <Route path="gerant/flux" element={<Navigate to="/backoffice/gerant" replace />} />
        <Route path="gerant/creneaux" element={<Navigate to="/backoffice/gerant/parametres" replace />} />
        <Route path="gerant/tarifs" element={<Navigate to="/backoffice/gerant/finances" replace />} />
        <Route path="gerant/reservations" element={<Navigate to="/backoffice/gerant/joueurs" replace />} />
        <Route path="gerant/portefeuille" element={<Navigate to="/backoffice/gerant/finances" replace />} />
        <Route path="gerant/scanner" element={<Navigate to="/backoffice/gerant" replace />} />
        <Route path="proprietaire" element={<RoleGuard roles={["proprietaire"]}>{withSuspense(ProprietaireDashboard)}</RoleGuard>} />
        <Route path="proprietaire/revenus" element={<RoleGuard roles={["proprietaire"]}>{withSuspense(MesRevenus)}</RoleGuard>} />
        <Route path="proprietaire/sante" element={<RoleGuard roles={["proprietaire"]}>{withSuspense(SanteProprietaire)}</RoleGuard>} />
        <Route path="proprietaire/profil" element={<Navigate to="/profil" replace />} />
        <Route path="proprietaire/terrain/:id" element={<RoleGuard roles={["proprietaire"]}>{withSuspense(TerrainDetail)}</RoleGuard>} />
      </Route>

      <Route path="/proprietaire" element={<Navigate to="/backoffice/proprietaire" replace />} />
      <Route path="/proprietaire/rapports" element={<Navigate to="/backoffice/proprietaire/revenus" replace />} />
      <Route path="/proprietaire/terrain/:id" element={<RedirectProprietaireTerrain />} />
      <Route path="/gerant" element={<Navigate to="/backoffice/gerant" replace />} />
      <Route path="/gerant/calendrier" element={<Navigate to="/backoffice/gerant/creneaux" replace />} />
      <Route path="/admin" element={<Navigate to="/backoffice/admin" replace />} />
      <Route path="*" element={withSuspense(NotFound)} />
    </Routes>
  );
}
