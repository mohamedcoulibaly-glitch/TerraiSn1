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

  const refresh = useCallback(async () => {
    try {
      const data = (await gerantApi.whatsappStatus()) as WaStatus;
      setStatus(data);
      if (data.mock) {
        setQr(null);
        setPairingCode(null);
        return;
      }
      if (data.connected) {
        setQr(null);
        setPairingCode(null);
        return;
      }
      if (data.hasQr || data.initializing || data.pairingCode) {
        const payload = (await gerantApi.whatsappQr()) as WaStatus;
        if (payload.dataUrl) setQr(payload.dataUrl);
        if (payload.pairingCode) setPairingCode(payload.pairingCode);
        setStatus((prev) => ({ ...prev, ...payload }));
      }
    } catch {
      /* ignore polling errors */
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 3500);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const connect = async (force = false) => {
    setBusy(true);
    try {
      const data = (await gerantApi.whatsappConnect({ force })) as WaStatus;
      setStatus(data);
      if (data.mock) {
        setQr(null);
        setPairingCode(null);
        toast.error("WhatsApp est en mode MOCK. Désactivez WHATSAPP_MOCK puis redémarrez l’API.");
        return;
      }
      if (data.connected) {
        setQr(null);
        setPairingCode(null);
        toast.success("WhatsApp du gérant connecté");
        return;
      }
      if (data.dataUrl) setQr(data.dataUrl);
      if (data.pairingCode) setPairingCode(data.pairingCode);

      if (data.pairingCode) {
        toast.success(`Code : ${formatPairingCode(data.pairingCode)} — saisissez-le sur le téléphone`);
        return;
      }
      if (data.dataUrl) {
        toast.success("QR prêt — ou utilisez le code d’appairage s’il s’affiche");
        return;
      }

      toast.message("Génération en cours…");
      for (let i = 0; i < 20; i += 1) {
        await new Promise((r) => setTimeout(r, 1500));
        const payload = (await gerantApi.whatsappQr()) as WaStatus;
        setStatus((prev) => ({ ...prev, ...payload }));
        if (payload.connected) {
          setQr(null);
          setPairingCode(null);
          toast.success("WhatsApp du gérant connecté");
          return;
        }
        if (payload.pairingCode) {
          setPairingCode(payload.pairingCode);
          toast.success(`Code : ${formatPairingCode(payload.pairingCode)}`);
          return;
        }
        if (payload.dataUrl) {
          setQr(payload.dataUrl);
        }
      }
      toast.error(data.error || "Impossible d’obtenir QR/code. Cliquez Nouveau QR.");
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
  const authenticating = status?.waState === "AUTHENTICATED" || /OPENING|PAIRING/i.test(String(status?.waState || ""));

  return (
    <section className="bg-white rounded-[var(--radius-md)] border border-[var(--color-border)] p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold inline-flex items-center gap-2">
            <MessageCircle className="w-4 h-4 text-[#25D366]" />
            WhatsApp expéditeur
          </h2>
          <p className="text-xs text-[var(--color-text-secondary)] mt-1">
            Les joueurs reçoivent les liens depuis <strong>votre</strong> numéro.
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
          {mock ? "Mode test" : connected ? "Connecté" : authenticating ? "Connexion…" : "À connecter"}
        </span>
      </div>

      {phone ? (
        <p className="text-sm font-medium" style={{ fontFamily: "var(--font-display)" }}>
          {phone}
        </p>
      ) : (
        <p className="text-sm text-[var(--color-text-muted)]">Aucun numéro WhatsApp lié à ce compte.</p>
      )}

      {pairingCode && !connected && !mock ? (
        <div className="rounded-xl border border-[#25D366]/40 bg-[color-mix(in_srgb,#25D366_8%,white)] p-4 text-center space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#128C7E]">
            Méthode recommandée — code d’appairage
          </p>
          <p
            className="text-3xl font-bold tracking-[0.2em] text-[var(--color-text-primary)]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {formatPairingCode(pairingCode)}
          </p>
          <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed">
            Sur le téléphone (<strong>{status?.pairingPhone || phone || "75 014 71 38"}</strong>) :
            <br />
            WhatsApp → Paramètres → Appareils connectés → Connecter un appareil →{" "}
            <strong>Lier avec un numéro de téléphone</strong>
            <br />
            puis saisissez ce code (sans recharger la page).
          </p>
        </div>
      ) : null}

      {qr && !connected && !mock ? (
        <div className="flex flex-col items-center gap-2 py-2">
          <img
            src={qr}
            alt="QR WhatsApp gérant"
            className="w-44 h-44 rounded-lg border border-[var(--color-border)] bg-white"
          />
          <p className="text-xs text-center text-[var(--color-text-secondary)] max-w-xs">
            Alternative : scannez ce QR (Appareils connectés → Connecter un appareil).
            <br />
            Preférez le <strong>code</strong> ci-dessus si le scan échoue.
          </p>
        </div>
      ) : null}

      {status?.error && !mock ? (
        <p className="text-xs text-[var(--color-danger)]">{status.error}</p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {!connected && (
          <>
            <button
              type="button"
              onClick={() => connect(Boolean(qr || pairingCode))}
              disabled={busy || mock}
              className="min-h-[44px] px-4 rounded-[var(--radius-sm)] bg-[#25D366] text-white text-sm font-medium inline-flex items-center gap-2 disabled:opacity-60"
            >
              {busy || status?.initializing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <QrCode className="w-4 h-4" />
              )}
              {busy
                ? "Préparation…"
                : qr || pairingCode
                  ? "Nouveau QR / code"
                  : "Connecter mon WhatsApp"}
            </button>
          </>
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
