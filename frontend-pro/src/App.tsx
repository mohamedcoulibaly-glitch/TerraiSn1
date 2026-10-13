import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/use-auth";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { ToastProvider } from "@/contexts/ToastContext";
import AppRouter from "@/router/AppRouter";
import InstallPrompt from "@/components/pwa/InstallPrompt";
import OfflineBanner from "@/components/pwa/OfflineBanner";
import PushPermissionBanner from "@/components/pwa/PushPermissionBanner";
import { REACT_QUERY_CONFIG } from "@/lib/optimizations";

const queryClient = new QueryClient({
  defaultOptions: REACT_QUERY_CONFIG,
});

/** Support VITE_BASE=/pro/ (mono-host) ou / (domaine pro.terrainsn.com) */
const routerBasename = (() => {
  const base = String(import.meta.env.BASE_URL || "/").replace(/\/$/, "");
  return base || undefined;
})();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <ToastProvider>
        <AuthProvider>
          <TooltipProvider>
            <Toaster />
            {/* Toaster sonner unique : tous les rôles (couleurs, icônes, sons, 3 max, 4 s) */}
            <Sonner />
            <OfflineBanner />
            <PushPermissionBanner />
            <BrowserRouter basename={routerBasename}>
              <AppRouter />
              <InstallPrompt />
            </BrowserRouter>
          </TooltipProvider>
        </AuthProvider>
      </ToastProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
