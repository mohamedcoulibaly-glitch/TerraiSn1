import { useEffect, useState } from "react";
import { WHATSAPP_INFRA_MESSAGE, isWhatsappInfraDown } from "@/lib/whatsappMessages";

const API_URL = import.meta.env.VITE_API_URL || "/api";

export function useWhatsappInfra(enabled = true) {
  const [down, setDown] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    async function ping() {
      try {
        const res = await fetch(`${API_URL}/whatsapp/health`, { cache: "no-store", credentials: "include" });
        const data = await res.json().catch(() => ({}));
        if (!cancelled) setDown(isWhatsappInfraDown(data));
      } catch {
        if (!cancelled) setDown(false);
      }
    }

    ping();
    const timer = window.setInterval(ping, 15000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [enabled]);

  return { down, message: WHATSAPP_INFRA_MESSAGE };
}
