import { useCallback, useEffect, useState } from "react";
import { Loader2, MessageCircle, QrCode, Unplug } from "lucide-react";
import { toast } from "sonner";
import { gerantApi } from "@/lib/api";
import { WHATSAPP_INFRA_MESSAGE } from "@/lib/whatsappMessages";

type WaStatus = {
  connected?: boolean;
  mock?: boolean;
  hasQr?: boolean;
  initializing?: boolean;
  error?: string | null;
  phone?: string | null;
  dataUrl?: string | null;
  pairingCode?: string | null;
  pairingPhone?: string | null;
  waState?: string | null;
  configured_number?: string | null;
  connected_wid?: string | null;
};

function formatPairingCode(code: string) {
  const clean = code.replace(/\s/g, "").toUpperCase();
  if (clean.length === 8) return `${clean.slice(0, 4)}-${clean.slice(4)}`;
  return clean;
}

export default function WhatsAppGerantCard() {
  const [status, setStatus] = useState<WaStatus | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const applyPayload = (payload: WaStatus) => {
    setStatus((prev) => ({ ...prev, ...payload }));
    if (payload.connected) {
      setQr(null);
      setPairingCode(null);
      return;
    }
    if (payload.dataUrl) setQr(payload.dataUrl);
    if (payload.pairingCode) setPairingCode(payload.pairingCode);
  };

  const refresh = useCallback(async () => {
    try {
      const data = (await gerantApi.whatsappStatus()) as WaStatus;
      if (data.connected) {
        setStatus(data);
        setQr(null);
        setPairingCode(null);
        return data;
      }
      const payload = (await gerantApi.whatsappQr()) as WaStatus;
      applyPayload({ ...data, ...payload });
      return { ...data, ...payload };
    } catch {
      return null;
    }
  }, []);

  const connect = useCallback(async (force = false) => {
    setBusy(true);
    try {
      const data = (await gerantApi.whatsappConnect({ force })) as WaStatus;
      applyPayload(data);
      if (data.mock) {
        setQr(null);
        setPairingCode(null);
        toast.error(WHATSAPP_INFRA_MESSAGE);
        return;
      }
      if (data.connected) {
        toast.success("WhatsApp du gérant connecté");
        return;
      }
      if (!data.dataUrl && !data.pairingCode) {
        toast.error(data.error || WHATSAPP_INFRA_MESSAGE);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : WHATSAPP_INFRA_MESSAGE);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 4000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const disconnect = async () => {
    setBusy(true);
    try {
      await gerantApi.whatsappDisconnect();
      setQr(null);
      setPairingCode(null);
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
  const waitingScan = Boolean((qr || pairingCode) && !connected && !mock);

  return (
    <section className="bg-white rounded-[var(--radius-md)] border border-[var(--color-border)] p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold inline-flex items-center gap-2">
            <MessageCircle className="w-4 h-4 text-[#25D366]" />
            WhatsApp expéditeur
          </h2>
          <p className="text-xs text-[var(--color-text-secondary)] mt-1">
            Scannez le QR, ou utilisez le code. Ne fermez pas cette page pendant la liaison.
          </p>
        </div>
        <span
          className={`shrink-0 text-[11px] font-semibold px-2.5 py-1 rounded-full ${
            mock
              ? "bg-[var(--color-surface-2)] text-[var(--color-text-muted)]"
              : connected
                ? "bg-[color-mix(in_srgb,#25D366_16%,white)] text-[#128C7E]"
                : waitingScan
                  ? "bg-[color-mix(in_srgb,#25D366_16%,white)] text-[#128C7E]"
                  : "bg-[color-mix(in_srgb,var(--color-warning)_16%,white)] text-[var(--color-warning)]"
          }`}
        >
          {mock ? "Mode test" : connected ? "Connecté" : waitingScan ? "En attente du scan" : "À connecter"}
        </span>
      </div>

      {phone ? (
        <p className="text-sm font-medium" style={{ fontFamily: "var(--font-display)" }}>
          {phone}
        </p>
      ) : null}

      {busy && !qr && !connected ? (
        <p className="text-sm text-[var(--color-text-secondary)] inline-flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          Génération du QR…
        </p>
      ) : null}

      {qr && !connected && !mock && status?.waState !== "authenticating" && status?.waState !== "restarting" ? (
        <div className="flex flex-col items-center gap-2 py-2">
          <img
            key={qr.slice(-48)}
            src={qr}
            alt="QR WhatsApp"
            className="w-52 h-52 rounded-lg border border-[var(--color-border)] bg-white p-2"
          />
          <p className="text-xs text-center text-[var(--color-text-secondary)] max-w-xs">
            Sur le <strong>téléphone principal</strong> (pas un appareil déjà lié) :
            WhatsApp → Paramètres → Appareils connectés → Connecter un appareil, puis scannez
            <strong> ce </strong> QR. Si WhatsApp refuse, attendez 2 minutes, retirez un ancien appareil
            lié, puis cliquez sur Nouveau QR.
          </p>
        </div>
      ) : null}

      {(status?.waState === "authenticating" || status?.waState === "restarting") && !connected ? (
        <p className="text-sm text-[var(--color-text-secondary)] inline-flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          {status?.waState === "restarting"
            ? "Finalisation de la liaison… ne fermez pas cette page."
            : "Validation en cours sur le téléphone… ne fermez pas cette page."}
        </p>
      ) : null}

      {pairingCode && !connected && !mock ? (
        <div className="rounded-xl border border-[#25D366]/40 bg-[color-mix(in_srgb,#25D366_8%,white)] p-4 text-center space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#128C7E]">
            Ou code d’appairage
          </p>
          <p
            className="text-3xl font-bold tracking-[0.2em] text-[var(--color-text-primary)]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {formatPairingCode(pairingCode)}
          </p>
          <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed">
            Connecter un appareil → <strong>Lier avec un numéro de téléphone</strong>
            {status?.pairingPhone || phone ? (
              <>
                {" "}
                (<strong>{status?.pairingPhone || phone}</strong>)
              </>
            ) : null}
          </p>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {!connected && !waitingScan && (
          <button
            type="button"
            onClick={() => connect(false)}
            disabled={busy || mock}
            className="min-h-[44px] px-4 rounded-[var(--radius-sm)] bg-[#25D366] text-white text-sm font-medium inline-flex items-center gap-2 disabled:opacity-60"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <QrCode className="w-4 h-4" />}
            {busy ? "Préparation…" : "Connecter mon WhatsApp"}
          </button>
        )}
        {waitingScan && (
          <button
            type="button"
            onClick={() => connect(true)}
            disabled={busy || mock}
            className="min-h-[44px] px-4 rounded-[var(--radius-sm)] border border-[var(--color-border)] text-sm font-medium inline-flex items-center gap-2 disabled:opacity-60"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <QrCode className="w-4 h-4" />}
            Nouveau QR
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
