import { lazy, Suspense, type LazyExoticComponent, type ComponentType } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { JoueurSpaceGuard, RequireJoueurAuth } from "@/auth/RoleGuard";
import JoueurLayout from "@/espaces/joueur/layout/JoueurLayout";
import { FieldGridSkeleton } from "@/components/skeletons/TerrainSkeletons";

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
const ProfilNotifications = lazy(() => import("@/espaces/joueur/pages/ProfilNotifications"));
const ProfilSecurite = lazy(() => import("@/espaces/joueur/pages/ProfilSecurite"));
const ProfilAide = lazy(() => import("@/espaces/joueur/pages/ProfilAide"));
const ChangePassword = lazy(() => import("@/espaces/joueur/pages/ChangePassword"));
const NotFound = lazy(() => import("@/espaces/joueur/pages/NotFound"));

export default function AppRouter() {
  return (
    <Routes>
      <Route path="/login" element={withSuspense(LoginPage)} />
      <Route path="/connexion" element={<Navigate to="/login" replace />} />
      <Route path="/changer-mot-de-passe" element={withSuspense(ChangePassword)} />
      <Route path="/profil" element={<Navigate to="/profil/joueur" replace />} />
      <Route path="/profil/joueur" element={<RequireJoueurAuth>{withSuspense(ProfilJoueur)}</RequireJoueurAuth>} />

      {/* Simulation PayTech — hors layout joueur */}
      <Route path="/paiement/mock" element={<RequireJoueurAuth>{withSuspense(MockPayment)}</RequireJoueurAuth>} />
      <Route path="/simulation/paiement" element={<RequireJoueurAuth>{withSuspense(MockPayment)}</RequireJoueurAuth>} />

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
        <Route path="/reservations" element={<RequireJoueurAuth>{withSuspense(MesReservations)}</RequireJoueurAuth>} />
        <Route path="/reservation/confirmation" element={<RequireJoueurAuth>{withSuspense(Confirmation)}</RequireJoueurAuth>} />
        <Route path="/reservation/succes" element={<RequireJoueurAuth>{withSuspense(ReservationSuccess)}</RequireJoueurAuth>} />
        <Route path="/reservation/annule" element={<RequireJoueurAuth>{withSuspense(ReservationCancelled)}</RequireJoueurAuth>} />
        <Route path="/profil/notifications" element={<RequireJoueurAuth>{withSuspense(ProfilNotifications)}</RequireJoueurAuth>} />
        <Route path="/profil/securite" element={<RequireJoueurAuth>{withSuspense(ProfilSecurite)}</RequireJoueurAuth>} />
        <Route path="/profil/aide" element={<RequireJoueurAuth>{withSuspense(ProfilAide)}</RequireJoueurAuth>} />
        <Route path="/profil/modifier" element={<Navigate to="/profil/joueur" replace />} />
      </Route>

      <Route path="*" element={withSuspense(NotFound)} />
    </Routes>
  );
}
