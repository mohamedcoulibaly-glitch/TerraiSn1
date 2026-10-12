import type { CSSProperties } from "react";
import { Toaster as Sonner, toast } from "sonner";
import { AlertTriangle, CheckCircle, Info, XCircle } from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { installToastSounds } from "@/lib/appToast";
import "./sonner.css";

type ToasterProps = React.ComponentProps<typeof Sonner>;

/** Durée d'affichage unique pour tous les acteurs (joueur, gérant, propriétaire, super_admin). */
export const TOAST_DURATION_MS = 4000;
/** Nombre maximum de toasts visibles en même temps. */
export const TOAST_MAX_VISIBLE = 3;

// Les ~60 fichiers qui font `import { toast } from "sonner"` bénéficient du son sans modification.
installToastSounds();

const iconProps = { size: 20, strokeWidth: 2.25, "aria-hidden": true } as const;

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme } = useTheme();
  const isMobile = useIsMobile();

  return (
    <Sonner
      theme={(theme === "dark" ? "dark" : "light") as ToasterProps["theme"]}
      className="toaster group terrainsn-toaster"
      position={isMobile ? "bottom-center" : "bottom-right"}
      closeButton
      duration={TOAST_DURATION_MS}
      visibleToasts={TOAST_MAX_VISIBLE}
      style={{ "--terrainsn-toast-duration": `${TOAST_DURATION_MS}ms` } as CSSProperties}
      icons={{
        success: <CheckCircle {...iconProps} />,
        error: <XCircle {...iconProps} />,
        warning: <AlertTriangle {...iconProps} />,
        info: <Info {...iconProps} />,
      }}
      toastOptions={{
        classNames: {
          toast: "group toast",
          description: "group-[.toast]:text-white/90",
          actionButton: "group-[.toast]:bg-white group-[.toast]:text-gray-900",
          cancelButton: "group-[.toast]:bg-white/20 group-[.toast]:text-white",
        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };
