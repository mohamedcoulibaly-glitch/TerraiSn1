import { Navigate, Route, Routes, useParams } from "react-router-dom";
import RoleGuard, { JoueurSpaceGuard, RequireAnyAuth, RequireJoueurAuth } from "@/auth/RoleGuard";
import LoginPage from "@/auth/LoginPage";
import BackofficeLoginPage from "@/auth/BackofficeLoginPage";

import JoueurLayout from "@/espaces/joueur/layout/JoueurLayout";
import Accueil from "@/espaces/joueur/pages/Accueil";
import RechercheTerrain from "@/espaces/joueur/pages/RechercheTerrain";
import FicheTerrain from "@/espaces/joueur/pages/FicheTerrain";
import Reservation from "@/espaces/joueur/pages/Reservation";
import MockPayment from "@/espaces/joueur/pages/MockPayment";
import Confirmation from "@/espaces/joueur/pages/Confirmation";
import MesReservations from "@/espaces/joueur/pages/MesReservations";
import ReservationSuccess from "@/espaces/joueur/pages/ReservationSuccess";
import ReservationCancelled from "@/espaces/joueur/pages/ReservationCancelled";
import ProfilJoueur from "@/espaces/profil/ProfilJoueur";
import ProfilGerant from "@/espaces/profil/ProfilGerant";
import ProfilProprietaire from "@/espaces/profil/ProfilProprietaire";
import ProfilAdmin from "@/espaces/profil/ProfilAdmin";
import ProfilNotifications from "@/espaces/joueur/pages/ProfilNotifications";
import ProfilSecurite from "@/espaces/joueur/pages/ProfilSecurite";
import ProfilAide from "@/espaces/joueur/pages/ProfilAide";
import ChangePassword from "@/espaces/joueur/pages/ChangePassword";
import NotFound from "@/espaces/joueur/pages/NotFound";

import BackofficeLayout from "@/espaces/backoffice/layout/BackofficeLayout";
import SuperAdminDashboard from "@/espaces/backoffice/pages/superadmin/Dashboard";
import GestionTerrains from "@/espaces/backoffice/pages/superadmin/GestionTerrains";
import GestionUtilisateurs from "@/espaces/backoffice/pages/superadmin/GestionUtilisateurs";
import RevenusAdmin from "@/espaces/backoffice/pages/superadmin/Revenus";
import AbonnementsAdmin from "@/espaces/backoffice/pages/superadmin/Abonnements";

import GerantDashboard from "@/espaces/backoffice/pages/gerant/Dashboard";
import GestionCreneaux from "@/espaces/backoffice/pages/gerant/GestionCreneaux";
import ReservationsManuelles from "@/espaces/backoffice/pages/gerant/ReservationsManuelles";
import ScannerGerant from "@/espaces/backoffice/pages/gerant/Scanner";

import ProprietaireDashboard from "@/espaces/backoffice/pages/proprietaire/Dashboard";
import MesRevenus from "@/espaces/backoffice/pages/proprietaire/MesRevenus";
import TerrainDetail from "@/espaces/backoffice/pages/proprietaire/TerrainDetail";
import SanteProprietaire from "@/espaces/backoffice/pages/proprietaire/Sante";
import { profileForUser } from "@/auth/roles";
import { useAuth } from "@/hooks/use-auth";

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
      <Route path="/login" element={<LoginPage />} />
      <Route path="/connexion" element={<Navigate to="/login" replace />} />
      <Route path="/changer-mot-de-passe" element={<ChangePassword />} />
      <Route path="/backoffice/login" element={<BackofficeLoginPage />} />
      <Route path="/profil" element={<RequireAnyAuth><RedirectProfilByRole /></RequireAnyAuth>} />
      <Route path="/profil/joueur" element={<RequireJoueurAuth><ProfilJoueur /></RequireJoueurAuth>} />
      <Route path="/profil/gerant" element={<RoleGuard roles={["gerant"]}><ProfilGerant /></RoleGuard>} />
      <Route path="/profil/proprietaire" element={<RoleGuard roles={["proprietaire"]}><ProfilProprietaire /></RoleGuard>} />
      <Route path="/profil/admin" element={<RoleGuard roles={["super_admin"]}><ProfilAdmin /></RoleGuard>} />
      <Route path="/backoffice/gerant/scanner" element={<RoleGuard roles={["gerant"]}><ScannerGerant /></RoleGuard>} />

      <Route
        element={
          <JoueurSpaceGuard>
            <JoueurLayout />
          </JoueurSpaceGuard>
        }
      >
        <Route path="/" element={<Accueil />} />
        <Route path="/explorer" element={<RechercheTerrain />} />
        <Route path="/terrain/:id" element={<FicheTerrain />} />
        <Route path="/paiement/:id" element={<RequireJoueurAuth><Reservation /></RequireJoueurAuth>} />
        <Route path="/paiement/mock" element={<RequireJoueurAuth><MockPayment /></RequireJoueurAuth>} />
        <Route path="/simulation/paiement" element={<RequireJoueurAuth><MockPayment /></RequireJoueurAuth>} />
        <Route path="/reservations" element={<RequireJoueurAuth><MesReservations /></RequireJoueurAuth>} />
        <Route path="/reservation/confirmation" element={<RequireJoueurAuth><Confirmation /></RequireJoueurAuth>} />
        <Route path="/reservation/succes" element={<RequireJoueurAuth><ReservationSuccess /></RequireJoueurAuth>} />
        <Route path="/reservation/annule" element={<RequireJoueurAuth><ReservationCancelled /></RequireJoueurAuth>} />
        <Route path="/profil/notifications" element={<RequireJoueurAuth><ProfilNotifications /></RequireJoueurAuth>} />
        <Route path="/profil/securite" element={<RequireJoueurAuth><ProfilSecurite /></RequireJoueurAuth>} />
        <Route path="/profil/aide" element={<RequireJoueurAuth><ProfilAide /></RequireJoueurAuth>} />
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
        <Route path="admin" element={<RoleGuard roles={["super_admin"]}><SuperAdminDashboard /></RoleGuard>} />
        <Route path="admin/terrains" element={<RoleGuard roles={["super_admin"]}><GestionTerrains /></RoleGuard>} />
        <Route path="admin/utilisateurs" element={<RoleGuard roles={["super_admin"]}><GestionUtilisateurs /></RoleGuard>} />
        <Route path="admin/revenus" element={<RoleGuard roles={["super_admin"]}><RevenusAdmin /></RoleGuard>} />
        <Route path="admin/abonnements" element={<RoleGuard roles={["super_admin"]}><AbonnementsAdmin /></RoleGuard>} />
        <Route path="admin/profil" element={<Navigate to="/profil" replace />} />
        <Route path="gerant" element={<RoleGuard roles={["gerant"]}><GerantDashboard /></RoleGuard>} />
        <Route path="gerant/creneaux" element={<RoleGuard roles={["gerant"]}><GestionCreneaux /></RoleGuard>} />
        <Route path="gerant/reservations" element={<RoleGuard roles={["gerant"]}><ReservationsManuelles /></RoleGuard>} />
        <Route path="proprietaire" element={<RoleGuard roles={["proprietaire"]}><ProprietaireDashboard /></RoleGuard>} />
        <Route path="proprietaire/revenus" element={<RoleGuard roles={["proprietaire"]}><MesRevenus /></RoleGuard>} />
        <Route path="proprietaire/sante" element={<RoleGuard roles={["proprietaire"]}><SanteProprietaire /></RoleGuard>} />
        <Route path="proprietaire/profil" element={<Navigate to="/profil" replace />} />
        <Route path="proprietaire/terrain/:id" element={<RoleGuard roles={["proprietaire"]}><TerrainDetail /></RoleGuard>} />
      </Route>

      <Route path="/proprietaire" element={<Navigate to="/backoffice/proprietaire" replace />} />
      <Route path="/proprietaire/rapports" element={<Navigate to="/backoffice/proprietaire/revenus" replace />} />
      <Route path="/proprietaire/terrain/:id" element={<RedirectProprietaireTerrain />} />
      <Route path="/gerant" element={<Navigate to="/backoffice/gerant" replace />} />
      <Route path="/gerant/calendrier" element={<Navigate to="/backoffice/gerant/creneaux" replace />} />
      <Route path="/admin" element={<Navigate to="/backoffice/admin" replace />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
