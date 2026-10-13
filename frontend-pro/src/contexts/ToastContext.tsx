import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { appToast, installToastSounds, type AppToast } from "@/lib/appToast";
import { isToastSoundEnabled, setToastSoundEnabled } from "@/lib/toastSound";

interface ToastContextValue {
  /** success / error / warning / info — mêmes styles et sons pour tous les rôles. */
  toast: AppToast;
  soundEnabled: boolean;
  setSoundEnabled: (enabled: boolean) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  installToastSounds();
  const [soundEnabled, setSoundState] = useState<boolean>(() => isToastSoundEnabled());

  const setSoundEnabled = useCallback((enabled: boolean) => {
    setToastSoundEnabled(enabled);
    setSoundState(enabled);
  }, []);

  const value = useMemo<ToastContextValue>(
    () => ({ toast: appToast, soundEnabled, setSoundEnabled }),
    [soundEnabled, setSoundEnabled],
  );

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

/**
 * Hook toast commun. Fonctionne aussi sans provider (fallback sur sonner + préférence locale),
 * pour rester utilisable dans les tests et les composants isolés.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useAppToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (ctx) return ctx;
  return {
    toast: appToast,
    soundEnabled: isToastSoundEnabled(),
    setSoundEnabled: setToastSoundEnabled,
  };
}
