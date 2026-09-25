import { useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { WHATSAPP_INFRA_MESSAGE } from "@/lib/whatsappMessages";

type Props = {
  visible: boolean;
  tone?: "gerant" | "superadmin";
};

const DISMISS_KEY = "wa-infra-banner-dismissed";

export default function WhatsAppInfraBanner({ visible, tone = "gerant" }: Props) {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  });
  if (!visible || dismissed) return null;
  const danger = tone === "superadmin" ? "var(--sa-danger)" : "var(--g-danger, #dc2626)";
  const bg = tone === "superadmin" ? "var(--sa-danger-bg, color-mix(in srgb, var(--sa-danger) 12%, white))" : "color-mix(in srgb, var(--g-danger, #dc2626) 12%, var(--g-surface))";
  const text = tone === "superadmin" ? "var(--sa-text)" : "var(--g-text)";

  return (
    <div
      role="alert"
      className="sticky top-0 z-20 px-3 py-2.5 flex items-start gap-2"
      style={{ background: bg, borderBottom: `1px solid ${danger}` }}
    >
      <AlertTriangle size={16} className="shrink-0 mt-0.5" style={{ color: danger }} />
      <p className="flex-1 text-[13px] font-semibold leading-snug" style={{ color: text }}>
        {WHATSAPP_INFRA_MESSAGE}
      </p>
      <button
        type="button"
        className="shrink-0 min-h-[32px] min-w-[32px] grid place-items-center"
        aria-label="Fermer"
        onClick={() => {
          try {
            sessionStorage.setItem(DISMISS_KEY, "1");
          } catch {
            /* ignore */
          }
          setDismissed(true);
        }}
      >
        <X size={16} style={{ color: danger }} />
      </button>
    </div>
  );
}
