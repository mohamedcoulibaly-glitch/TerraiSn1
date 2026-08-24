import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { MessageCircle } from "lucide-react";
import { gerantApi } from "@/lib/api";

const PAIRING_PATH = "/backoffice/gerant/parametres?section=whatsapp";

/**
 * Bandeau compact permanent si la session WhatsApp gérant n'est pas connectée.
 * Ne confond pas avec la panne infra globale (WhatsAppInfraBanner).
 */
export default function WhatsAppGerantSessionBanner() {
  const location = useLocation();
  const [disconnected, setDisconnected] = useState(false);
  const onPairingPage =
    location.pathname.startsWith("/backoffice/gerant/parametres") &&
    new URLSearchParams(location.search).get("section") === "whatsapp";

  useEffect(() => {
    let cancelled = false;

    const ping = async () => {
      try {
        const s = (await gerantApi.whatsappStatus()) as {
          connected?: boolean;
          status?: string;
          mock?: boolean;
          initializing?: boolean;
        };
        if (cancelled) return;
        if (s?.mock) {
          setDisconnected(false);
          return;
        }
        const status = String(s?.status || "").toUpperCase();
        const ok =
          Boolean(s?.connected) ||
          status === "CONNECTED" ||
          status === "CONNECTING" ||
          Boolean(s?.initializing);
        setDisconnected(!ok);
      } catch {
        if (!cancelled) setDisconnected(false);
      }
    };

    ping();
    const timer = window.setInterval(ping, 20_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [location.pathname, location.search]);

  if (!disconnected || onPairingPage) return null;

  return (
    <div
      role="status"
      className="sticky top-14 z-20 flex items-center gap-2 px-3 py-1.5 text-[12px]"
      style={{
        background: "color-mix(in srgb, #f59e0b 14%, var(--g-surface))",
        borderBottom: "1px solid color-mix(in srgb, #f59e0b 35%, transparent)",
        color: "var(--g-text)",
      }}
    >
      <MessageCircle size={14} className="shrink-0 text-amber-600" aria-hidden />
      <p className="flex-1 min-w-0 truncate font-medium">
        WhatsApp déconnecté — les joueurs ne peuvent pas réserver en ligne
      </p>
      <Link
        to={PAIRING_PATH}
        className="shrink-0 inline-flex items-center justify-center min-h-[28px] px-2.5 rounded-lg text-[11px] font-bold text-white"
        style={{ background: "var(--g-primary)" }}
      >
        Connecter
      </Link>
    </div>
  );
}

export { PAIRING_PATH as WHATSAPP_PAIRING_PATH };
