import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/use-auth";
import { ThemeProvider } from "@/contexts/ThemeContext";
import AppRouter from "@/router/AppRouter";
import InstallPrompt from "@/components/pwa/InstallPrompt";
import OfflineBanner from "@/components/pwa/OfflineBanner";
import PushPermissionBanner from "@/components/pwa/PushPermissionBanner";
import { REACT_QUERY_CONFIG } from "@/lib/optimizations";

const queryClient = new QueryClient({
  defaultOptions: REACT_QUERY_CONFIG,
});

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <AuthProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <OfflineBanner />
          <PushPermissionBanner />
          <BrowserRouter>
            <AppRouter />
            <InstallPrompt />
          </BrowserRouter>
        </TooltipProvider>
      </AuthProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
