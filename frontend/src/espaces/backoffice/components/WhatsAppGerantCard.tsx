import { useCallback, useEffect, useState } from "react";
import { Loader2, MessageCircle, QrCode, Unplug } from "lucide-react";
import { toast } from "sonner";
import { gerantApi } from "@/lib/api";

type WaStatus = {
  connected?: boolean;
  mock?: boolean;
  hasQr?: boolean;
  initializing?: boolean;
  error?: string | null;
  phone?: string | null;
  dataUrl?: string | null;
  configured_number?: string | null;
  connected_wid?: string | null;
};

export default function WhatsAppGerantCard() {
  const [status, setStatus] = useState<WaStatus | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const data = (await gerantApi.whatsappStatus()) as WaStatus;
      setStatus(data);
      if (!data.connected && (data.hasQr || data.initializing)) {
        const payload = (await gerantApi.whatsappQr()) as WaStatus;
        setQr(payload.dataUrl || null);
        setStatus((prev) => ({ ...prev, ...payload }));
      } else if (data.connected) {
        setQr(null);
      }
    } catch {
      /* ignore polling errors */
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 4000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const connect = async () => {
    setBusy(true);
    try {
      const data = (await gerantApi.whatsappConnect()) as WaStatus;
      setStatus(data);
      setQr(data.dataUrl || null);
      toast.success(
        data.connected
          ? "WhatsApp du gérant connecté"
          : "QR généré — scannez avec votre téléphone",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Connexion WhatsApp impossible");
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      await gerantApi.whatsappDisconnect();
      setQr(null);
      await refresh();
      toast.success("WhatsApp déconnecté");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Déconnexion impossible");
    } finally {
      setBusy(false);
    }
  };

  const connected = Boolean(status?.connected);
  const mock = Boolean(status?.mock);
  const phone = status?.configured_number || status?.phone || status?.connected_wid;

  return (
    <section className="bg-white rounded-[var(--radius-md)] border border-[var(--color-border)] p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold inline-flex items-center gap-2">
            <MessageCircle className="w-4 h-4 text-[#25D366]" />
            WhatsApp expéditeur
          </h2>
          <p className="text-xs text-[var(--color-text-secondary)] mt-1">
            Les joueurs reçoivent les liens et QR depuis <strong>votre</strong> numéro, pas celui de la plateforme.
          </p>
        </div>
        <span
          className={`shrink-0 text-[11px] font-semibold px-2.5 py-1 rounded-full ${
            mock
              ? "bg-[var(--color-surface-2)] text-[var(--color-text-muted)]"
              : connected
                ? "bg-[color-mix(in_srgb,#25D366_16%,white)] text-[#128C7E]"
                : "bg-[color-mix(in_srgb,var(--color-warning)_16%,white)] text-[var(--color-warning)]"
          }`}
        >
          {mock ? "Mode test" : connected ? "Connecté" : "À connecter"}
        </span>
      </div>

      {phone ? (
        <p className="text-sm font-medium" style={{ fontFamily: "var(--font-display)" }}>
          {phone}
        </p>
      ) : (
        <p className="text-sm text-[var(--color-text-muted)]">Aucun numéro WhatsApp lié à ce compte.</p>
      )}

      {qr && !connected && !mock ? (
        <div className="flex flex-col items-center gap-2 py-2">
          <img src={qr} alt="QR WhatsApp gérant" className="w-44 h-44 rounded-lg border border-[var(--color-border)] bg-white" />
          <p className="text-xs text-center text-[var(--color-text-secondary)]">
            WhatsApp → Paramètres → Appareils connectés → Connecter un appareil
          </p>
        </div>
      ) : null}

      {status?.error ? (
        <p className="text-xs text-[var(--color-danger)]">{status.error}</p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {!connected && (
          <button
            type="button"
            onClick={connect}
            disabled={busy}
            className="min-h-[44px] px-4 rounded-[var(--radius-sm)] bg-[#25D366] text-white text-sm font-medium inline-flex items-center gap-2 disabled:opacity-60"
          >
            {busy || status?.initializing ? <Loader2 className="w-4 h-4 animate-spin" /> : <QrCode className="w-4 h-4" />}
            {qr ? "Actualiser le QR" : "Connecter mon WhatsApp"}
          </button>
        )}
        {connected && !mock && (
          <button
            type="button"
            onClick={disconnect}
            disabled={busy}
            className="min-h-[44px] px-4 rounded-[var(--radius-sm)] border border-[var(--color-border)] text-sm font-medium inline-flex items-center gap-2"
          >
            <Unplug className="w-4 h-4" />
            Déconnecter
          </button>
        )}
      </div>
    </section>
  );
}
