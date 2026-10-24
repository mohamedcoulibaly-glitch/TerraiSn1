import { lazy, Suspense, type LazyExoticComponent, type ComponentType } from "react";
import { Navigate, Route, Routes, useParams } from "react-router-dom";
import RoleGuard, { RequireAnyAuth } from "@/auth/RoleGuard";
import BackofficeLayout from "@/espaces/backoffice/layout/BackofficeLayout";
import { FieldGridSkeleton } from "@/components/skeletons/TerrainSkeletons";
import { homeForUser, normalizeRole, profileForUser } from "@/auth/roles";
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

const BackofficeLoginPage = lazy(() => import("@/auth/BackofficeLoginPage"));
const MockPayment = lazy(() => import("@/espaces/backoffice/pages/MockPayment"));
const ChangePassword = lazy(() => import("@/espaces/backoffice/pages/ChangePassword"));
const ProfilGerant = lazy(() => import("@/espaces/profil/ProfilGerant"));
const ProfilProprietaire = lazy(() => import("@/espaces/profil/ProfilProprietaire"));
const ProfilAdmin = lazy(() => import("@/espaces/profil/ProfilAdmin"));

const SuperAdminDashboard = lazy(() => import("@/espaces/backoffice/pages/superadmin/Dashboard"));
const GestionTerrains = lazy(() => import("@/espaces/backoffice/pages/superadmin/GestionTerrains"));
const RattachementsAdmin = lazy(() => import("@/espaces/backoffice/pages/superadmin/Rattachements"));
const TerrainFicheAdmin = lazy(() => import("@/espaces/backoffice/pages/superadmin/TerrainFiche"));
const GestionGerants = lazy(() => import("@/espaces/backoffice/pages/superadmin/GestionGerants"));
const GestionProprietaires = lazy(() => import("@/espaces/backoffice/pages/superadmin/GestionProprietaires"));
const GestionSuperadmins = lazy(() => import("@/espaces/backoffice/pages/superadmin/GestionSuperadmins"));
const GestionUtilisateurs = lazy(() => import("@/espaces/backoffice/pages/superadmin/GestionUtilisateurs"));
const RevenusAdmin = lazy(() => import("@/espaces/backoffice/pages/superadmin/Revenus"));
const CaisseAdmin = lazy(() => import("@/espaces/backoffice/pages/superadmin/Caisse"));
const RapprochementAdmin = lazy(() => import("@/espaces/backoffice/pages/superadmin/Rapprochement"));
const AbonnementsAdmin = lazy(() => import("@/espaces/backoffice/pages/superadmin/Abonnements"));
const CommoditesAdmin = lazy(() => import("@/espaces/backoffice/pages/superadmin/Commodites"));
const WhatsAppPlateforme = lazy(() => import("@/espaces/backoffice/pages/superadmin/WhatsAppPlateforme"));
const IntegrationsAdmin = lazy(() => import("@/espaces/backoffice/pages/superadmin/Integrations"));
const AuditAdmin = lazy(() => import("@/espaces/backoffice/pages/superadmin/Audit"));
const GerantDashboard = lazy(() => import("@/espaces/backoffice/pages/gerant/Dashboard"));
const GerantJoueurs = lazy(() => import("@/espaces/backoffice/pages/gerant/JoueursReservations"));
const HistoriqueGerant = lazy(() => import("@/espaces/backoffice/pages/gerant/Historique"));
const DetailReservationGerant = lazy(() => import("@/espaces/backoffice/pages/gerant/DetailReservation"));
const FinancesGerant = lazy(() => import("@/espaces/backoffice/pages/gerant/Finances"));
const ParametresGerant = lazy(() => import("@/espaces/backoffice/pages/gerant/Parametres"));
const ProprietaireDashboard = lazy(() => import("@/espaces/backoffice/pages/proprietaire/Dashboard"));
const MesRevenus = lazy(() => import("@/espaces/backoffice/pages/proprietaire/MesRevenus"));
const HistoriqueProprietaire = lazy(() => import("@/espaces/backoffice/pages/proprietaire/Historique"));
const MesTerrains = lazy(() => import("@/espaces/backoffice/pages/proprietaire/MesTerrains"));
const TerrainDetail = lazy(() => import("@/espaces/backoffice/pages/proprietaire/TerrainDetail"));
const SanteProprietaire = lazy(() => import("@/espaces/backoffice/pages/proprietaire/Sante"));
const AuditProprietaire = lazy(() => import("@/espaces/backoffice/pages/proprietaire/Audit"));

function RedirectProprietaireTerrain() {
  const { id } = useParams();
  return <Navigate to={`/backoffice/proprietaire/terrain/${id}`} replace />;
}

/** Redirige vers le profil du rôle pro ; tout autre rôle → /login. */
function RedirectProfilByRole() {
  const { user } = useAuth();
  const role = normalizeRole(user);
  if (!role || role === "joueur") return <Navigate to="/login" replace />;
  return <Navigate to={profileForUser(user)} replace />;
}

/** `/` → home du rôle si connecté, sinon /login. */
function RootRedirect() {
  const { user, isAuthenticated, loading } = useAuth();
  if (loading) return <PageLoader />;
  const role = normalizeRole(user);
  if (isAuthenticated && role && role !== "joueur") {
    return <Navigate to={homeForUser(user)} replace />;
  }
  return <Navigate to="/login" replace />;
}

/** 404 simple (app pro uniquement). */
function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted">
      <div className="text-center">
        <h1 className="mb-4 text-4xl font-bold">404</h1>
        <p className="mb-4 text-xl text-muted-foreground">Page introuvable</p>
        <a href={import.meta.env.BASE_URL || "/"} className="text-primary underline hover:text-primary/90">
          Retour à l&apos;accueil
        </a>
      </div>
    </div>
  );
}

export default function AppRouter() {
  return (
    <Routes>
      <Route path="/" element={<RootRedirect />} />
      <Route path="/login" element={withSuspense(BackofficeLoginPage)} />
      <Route path="/connexion" element={<Navigate to="/login" replace />} />
      <Route path="/backoffice/login" element={<Navigate to="/login" replace />} />
      <Route path="/changer-mot-de-passe" element={withSuspense(ChangePassword)} />
      <Route path="/profil" element={<RequireAnyAuth><RedirectProfilByRole /></RequireAnyAuth>} />
      <Route path="/profil/gerant" element={<RoleGuard roles={["gerant"]}>{withSuspense(ProfilGerant)}</RoleGuard>} />
      <Route path="/profil/proprietaire" element={<RoleGuard roles={["proprietaire"]}>{withSuspense(ProfilProprietaire)}</RoleGuard>} />
      <Route path="/profil/admin" element={<RoleGuard roles={["super_admin"]}>{withSuspense(ProfilAdmin)}</RoleGuard>} />

      {/* Simulation PayTech : paiement des dettes de commission (gérant) */}
      <Route path="/paiement/mock" element={<RequireAnyAuth>{withSuspense(MockPayment)}</RequireAnyAuth>} />
      <Route path="/simulation/paiement" element={<RequireAnyAuth>{withSuspense(MockPayment)}</RequireAnyAuth>} />

      <Route
        path="/backoffice"
        element={
          <RoleGuard roles={["super_admin", "gerant", "proprietaire"]}>
            <BackofficeLayout />
          </RoleGuard>
        }
      >
        <Route path="superadmin" element={<RoleGuard roles={["super_admin"]}>{withSuspense(SuperAdminDashboard)}</RoleGuard>} />
        <Route path="superadmin/terrains" element={<RoleGuard roles={["super_admin"]}>{withSuspense(GestionTerrains)}</RoleGuard>} />
        <Route path="superadmin/terrains/:id" element={<RoleGuard roles={["super_admin"]}>{withSuspense(TerrainFicheAdmin)}</RoleGuard>} />
        <Route path="superadmin/rattachements" element={<RoleGuard roles={["super_admin"]}>{withSuspense(RattachementsAdmin)}</RoleGuard>} />
        <Route path="superadmin/gerants" element={<RoleGuard roles={["super_admin"]}>{withSuspense(GestionGerants)}</RoleGuard>} />
        <Route path="superadmin/proprietaires" element={<RoleGuard roles={["super_admin"]}>{withSuspense(GestionProprietaires)}</RoleGuard>} />
        <Route path="superadmin/superadmins" element={<RoleGuard roles={["super_admin"]}>{withSuspense(GestionSuperadmins)}</RoleGuard>} />
        <Route path="superadmin/utilisateurs" element={<RoleGuard roles={["super_admin"]}>{withSuspense(GestionUtilisateurs)}</RoleGuard>} />
        <Route path="superadmin/caisse" element={<RoleGuard roles={["super_admin"]}>{withSuspense(CaisseAdmin)}</RoleGuard>} />
        <Route path="superadmin/audit" element={<RoleGuard roles={["super_admin"]}>{withSuspense(AuditAdmin)}</RoleGuard>} />
        <Route path="superadmin/rapprochement" element={<RoleGuard roles={["super_admin"]}>{withSuspense(RapprochementAdmin)}</RoleGuard>} />
        <Route path="superadmin/revenus" element={<RoleGuard roles={["super_admin"]}>{withSuspense(RevenusAdmin)}</RoleGuard>} />
        <Route path="superadmin/abonnements" element={<RoleGuard roles={["super_admin"]}>{withSuspense(AbonnementsAdmin)}</RoleGuard>} />
        <Route path="superadmin/commodites" element={<RoleGuard roles={["super_admin"]}>{withSuspense(CommoditesAdmin)}</RoleGuard>} />
        <Route path="superadmin/whatsapp" element={<RoleGuard roles={["super_admin"]}>{withSuspense(WhatsAppPlateforme)}</RoleGuard>} />
        <Route path="superadmin/integrations" element={<RoleGuard roles={["super_admin"]}>{withSuspense(IntegrationsAdmin)}</RoleGuard>} />
        <Route path="admin" element={<Navigate to="/backoffice/superadmin" replace />} />
        <Route path="admin/terrains" element={<Navigate to="/backoffice/superadmin/terrains" replace />} />
        <Route path="admin/utilisateurs" element={<Navigate to="/backoffice/superadmin/utilisateurs" replace />} />
        <Route path="admin/revenus" element={<Navigate to="/backoffice/superadmin/revenus" replace />} />
        <Route path="admin/abonnements" element={<Navigate to="/backoffice/superadmin/abonnements" replace />} />
        <Route path="admin/caisse" element={<Navigate to="/backoffice/superadmin/caisse" replace />} />
        <Route path="admin/rapprochement" element={<Navigate to="/backoffice/superadmin/rapprochement" replace />} />
        <Route path="admin/profil" element={<Navigate to="/profil" replace />} />
        <Route path="gerant" element={<RoleGuard roles={["gerant"]}>{withSuspense(GerantDashboard)}</RoleGuard>} />
        <Route path="gerant/joueurs" element={<RoleGuard roles={["gerant"]}>{withSuspense(GerantJoueurs)}</RoleGuard>} />
        <Route path="gerant/joueurs/:id" element={<RoleGuard roles={["gerant"]}>{withSuspense(GerantJoueurs)}</RoleGuard>} />
        <Route path="gerant/historique" element={<RoleGuard roles={["gerant"]}>{withSuspense(HistoriqueGerant)}</RoleGuard>} />
        <Route path="gerant/finances" element={<RoleGuard roles={["gerant"]}>{withSuspense(FinancesGerant)}</RoleGuard>} />
        <Route path="gerant/parametres" element={<RoleGuard roles={["gerant"]}>{withSuspense(ParametresGerant)}</RoleGuard>} />
        <Route path="gerant/reservations/:id" element={<RoleGuard roles={["gerant"]}>{withSuspense(DetailReservationGerant)}</RoleGuard>} />
        <Route path="gerant/flux" element={<Navigate to="/backoffice/gerant" replace />} />
        <Route path="gerant/creneaux" element={<Navigate to="/backoffice/gerant/parametres" replace />} />
        <Route path="gerant/tarifs" element={<Navigate to="/backoffice/gerant/parametres" replace />} />
        <Route path="gerant/reservations" element={<Navigate to="/backoffice/gerant/joueurs" replace />} />
        <Route path="gerant/portefeuille" element={<Navigate to="/backoffice/gerant/finances" replace />} />
        <Route path="gerant/scanner" element={<Navigate to="/backoffice/gerant" replace />} />
        <Route path="proprietaire" element={<RoleGuard roles={["proprietaire"]}>{withSuspense(ProprietaireDashboard)}</RoleGuard>} />
        <Route path="proprietaire/revenus" element={<RoleGuard roles={["proprietaire"]}>{withSuspense(MesRevenus)}</RoleGuard>} />
        <Route path="proprietaire/historique" element={<RoleGuard roles={["proprietaire"]}>{withSuspense(HistoriqueProprietaire)}</RoleGuard>} />
        <Route path="proprietaire/sante" element={<RoleGuard roles={["proprietaire"]}>{withSuspense(SanteProprietaire)}</RoleGuard>} />
        <Route path="proprietaire/audit" element={<RoleGuard roles={["proprietaire"]}>{withSuspense(AuditProprietaire)}</RoleGuard>} />
        <Route path="proprietaire/terrains" element={<RoleGuard roles={["proprietaire"]}>{withSuspense(MesTerrains)}</RoleGuard>} />
        <Route path="proprietaire/profil" element={<Navigate to="/profil" replace />} />
        <Route path="proprietaire/terrain/:id" element={<RoleGuard roles={["proprietaire"]}>{withSuspense(TerrainDetail)}</RoleGuard>} />
      </Route>

      <Route path="/proprietaire" element={<Navigate to="/backoffice/proprietaire" replace />} />
      <Route path="/proprietaire/rapports" element={<Navigate to="/backoffice/proprietaire/revenus" replace />} />
      <Route path="/proprietaire/terrain/:id" element={<RedirectProprietaireTerrain />} />
      <Route path="/gerant" element={<Navigate to="/backoffice/gerant" replace />} />
      <Route path="/gerant/calendrier" element={<Navigate to="/backoffice/gerant/creneaux" replace />} />
      <Route path="/admin" element={<Navigate to="/backoffice/superadmin" replace />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
