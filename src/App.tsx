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
import OwnerDashboard from "./pages/OwnerDashboard.tsx";
import ManagerDashboard from "./pages/ManagerDashboard.tsx";
import Connexion from "./pages/Connexion.tsx";
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
            <Route path="/connexion" element={<Connexion />} />
            <Route path="/proprietaire" element={<OwnerDashboard />} />
            <Route path="/gerant" element={<ManagerDashboard />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
          <BottomNav />
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
