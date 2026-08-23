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
    <section
      className="rounded-2xl p-4 space-y-5"
      style={{ background: "var(--g-surface)", boxShadow: "var(--g-shadow)" }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold inline-flex items-center gap-2" style={{ color: "var(--g-text)" }}>
            <MessageCircle className="w-5 h-5 text-[#25D366]" />
            Ton WhatsApp professionnel
          </h2>
          <p className="text-sm mt-1" style={{ color: "var(--g-muted)" }}>
            Relie ton téléphone pour envoyer les notifications du terrain.
          </p>
        </div>
        <span
          className="shrink-0 text-xs font-bold px-3 py-1.5 rounded-full"
          style={{
            background: connected ? "rgba(37, 211, 102, 0.16)" : "rgba(220, 38, 38, 0.12)",
            color: connected ? "#128C7E" : "#dc2626",
          }}
        >
          {connected ? "🟢 WhatsApp Connecté" : "🔴 Non Connecté"}
        </span>
      </div>

      {phone ? (
        <div className="rounded-xl p-3" style={{ background: "var(--g-surface-2)" }}>
          <p className="text-sm" style={{ color: "var(--g-muted)" }}>Numéro lié</p>
          <p className="text-base font-semibold mt-0.5" style={{ color: "var(--g-text)" }}>{phone}</p>
        </div>
      ) : null}

      {!connected ? (
        <div className="space-y-3">
          {[
            ["1", "Ouvre WhatsApp", "Sur ton téléphone principal (celui que tu utilises tous les jours)."],
            ["2", "Appareils connectés", "Va dans Paramètres → Appareils connectés."],
            ["3", "Scanne le QR", "Touche « Connecter un appareil », puis scanne le code ci-dessous."],
          ].map(([number, title, text]) => (
            <div key={number} className="flex items-start gap-3 min-h-[64px]">
              <span
                className="w-10 h-10 rounded-full shrink-0 inline-flex items-center justify-center text-base font-bold text-white"
                style={{ background: "#25D366" }}
              >
                {number}
              </span>
              <div className="pt-0.5">
                <p className="text-base font-semibold" style={{ color: "var(--g-text)" }}>{title}</p>
                <p className="text-sm mt-0.5" style={{ color: "var(--g-muted)" }}>{text}</p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div
          className="rounded-2xl p-4 text-center"
          style={{ background: "rgba(37, 211, 102, 0.12)", color: "#128C7E" }}
        >
          <p className="text-base font-semibold">Tout est prêt !</p>
          <p className="text-sm mt-1">Ton terrain peut envoyer ses messages WhatsApp.</p>
        </div>
      )}

      {busy && !qr && !connected ? (
        <p className="text-base inline-flex items-center gap-2" style={{ color: "var(--g-muted)" }}>
          <Loader2 className="w-5 h-5 animate-spin" />
          Préparation du QR…
        </p>
      ) : null}

      {qr && !connected && !mock && status?.waState !== "authenticating" && status?.waState !== "restarting" ? (
        <div className="flex flex-col items-center gap-3 py-2">
          <img
            key={qr.slice(-48)}
            src={qr}
            alt="QR à scanner avec WhatsApp"
            className="w-60 h-60 max-w-full rounded-2xl bg-white p-3"
            style={{ border: "1px solid var(--g-border)" }}
          />
          <p className="text-sm text-center max-w-sm" style={{ color: "var(--g-muted)" }}>
            Garde cette page ouverte pendant le scan. La connexion se confirmera automatiquement.
          </p>
        </div>
      ) : null}

      {(status?.waState === "authenticating" || status?.waState === "restarting") && !connected ? (
        <p className="text-base inline-flex items-center gap-2" style={{ color: "var(--g-muted)" }}>
          <Loader2 className="w-5 h-5 animate-spin" />
          {status?.waState === "restarting"
            ? "Finalisation de la liaison… garde cette page ouverte."
            : "Validation en cours sur ton téléphone…"}
        </p>
      ) : null}

      {pairingCode && !connected && !mock ? (
        <div className="rounded-2xl p-4 text-center space-y-2" style={{ background: "rgba(37, 211, 102, 0.1)", border: "1px solid rgba(37, 211, 102, 0.4)" }}>
          <p className="text-sm font-semibold uppercase tracking-wide text-[#128C7E]">Ou utilise ce code</p>
          <p
            className="text-3xl font-bold tracking-[0.2em]"
            style={{ fontFamily: "var(--font-display)", color: "var(--g-text)" }}
          >
            {formatPairingCode(pairingCode)}
          </p>
          <p className="text-sm leading-relaxed" style={{ color: "var(--g-muted)" }}>
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

      {mock ? (
        <p className="rounded-xl p-3 text-sm" style={{ background: "var(--g-surface-2)", color: "var(--g-muted)" }}>
          {WHATSAPP_INFRA_MESSAGE}
        </p>
      ) : null}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {!connected && !waitingScan && (
          <button
            type="button"
            onClick={() => connect(false)}
            disabled={busy || mock}
            className="min-h-[52px] px-4 rounded-xl bg-[#25D366] text-white text-base font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-60 sm:col-span-2"
          >
            {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <QrCode className="w-5 h-5" />}
            {busy ? "Préparation…" : "Afficher mon QR"}
          </button>
        )}
        {waitingScan && (
          <button
            type="button"
            onClick={() => connect(true)}
            disabled={busy || mock}
            className="min-h-[48px] px-4 rounded-xl text-base font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-60 sm:col-span-2"
            style={{ border: "1px solid var(--g-border)", color: "var(--g-text)" }}
          >
            {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <QrCode className="w-5 h-5" />}
            Générer un nouveau QR
          </button>
        )}
        {connected && !mock && (
          <button
            type="button"
            onClick={disconnect}
            disabled={busy}
            className="min-h-[48px] px-4 rounded-xl text-base font-semibold inline-flex items-center justify-center gap-2 sm:col-span-2"
            style={{ border: "1px solid var(--g-border)", color: "var(--g-text)" }}
          >
            {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Unplug className="w-5 h-5" />}
            Déconnecter WhatsApp
          </button>
        )}
      </div>
    </section>
  );
}
