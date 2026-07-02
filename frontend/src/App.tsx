import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/use-auth";
import BottomNav from "@/components/BottomNav";
import Index from "./pages/Index.tsx";
import Explorer from "./pages/Explorer.tsx";
import FieldDetails from "./pages/FieldDetails.tsx";
import Payment from "./pages/Payment.tsx";
import Reservations from "./pages/Reservations.tsx";
import Profil from "./pages/Profil.tsx";
import ProfilNotifications from "./pages/ProfilNotifications.tsx";
import ProfilSecurite from "./pages/ProfilSecurite.tsx";
import ProfilAide from "./pages/ProfilAide.tsx";
import OwnerDashboard from "./pages/OwnerDashboard.tsx";
import OwnerTerrainDetail from "./pages/OwnerTerrainDetail.tsx";
import OwnerReports from "./pages/OwnerReports.tsx";
import ManagerDashboard from "./pages/ManagerDashboard.tsx";
import ManagerCalendar from "./pages/ManagerCalendar.tsx";
import Connexion from "./pages/Connexion.tsx";
import ReservationConfirmation from "./pages/ReservationConfirmation.tsx";
import AdminDashboard from "./pages/AdminDashboard.tsx";
import NotFound from "./pages/NotFound.tsx";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/explorer" element={<Explorer />} />
            <Route path="/terrain/:id" element={<FieldDetails />} />
            <Route path="/paiement/:id" element={<Payment />} />
            <Route path="/reservations" element={<Reservations />} />
            <Route path="/profil" element={<Profil />} />
            <Route path="/profil/notifications" element={<ProfilNotifications />} />
            <Route path="/profil/securite" element={<ProfilSecurite />} />
            <Route path="/profil/aide" element={<ProfilAide />} />
            <Route path="/profil/modifier" element={<Profil />} />
            <Route path="/connexion" element={<Connexion />} />
            <Route path="/proprietaire" element={<OwnerDashboard />} />
            <Route path="/proprietaire/terrain/:id" element={<OwnerTerrainDetail />} />
            <Route path="/proprietaire/rapports" element={<OwnerReports />} />
            <Route path="/gerant" element={<ManagerDashboard />} />
            <Route path="/gerant/calendrier" element={<ManagerCalendar />} />
            <Route path="/reservation/confirmation" element={<ReservationConfirmation />} />
            <Route path="/admin" element={<AdminDashboard />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
          <BottomNav />
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
