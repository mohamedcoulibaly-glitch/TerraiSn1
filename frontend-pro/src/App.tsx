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

/**
 * Support VITE_BASE=/pro/ (mono-host) ou / (domaine dédié).
 * Fallback runtime : si le build a oublié VITE_BASE mais l’URL est sous /pro,
 * on évite la page 404 sur toutes les routes.
 */
const routerBasename = (() => {
  const fromEnv = String(import.meta.env.BASE_URL || "/").replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  if (typeof window !== "undefined") {
    const path = window.location.pathname || "";
    if (path === "/pro" || path.startsWith("/pro/")) return "/pro";
  }
  return undefined;
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
