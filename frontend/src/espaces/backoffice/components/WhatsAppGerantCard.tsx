import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, ExternalLink, Loader2, MessageCircle, Unplug } from "lucide-react";
import { toast } from "sonner";
import { gerantApi } from "@/lib/api";
import { WHATSAPP_INFRA_MESSAGE } from "@/lib/whatsappMessages";

type WaStatus = {
  connected?: boolean;
  status?: "CONNECTED" | "CONNECTING" | "DISCONNECTED" | string;
  mock?: boolean;
  initializing?: boolean;
  error?: string | null;
  phone?: string | null;
  pairingCode?: string | null;
  pairingCodeDisplay?: string | null;
  pairingPhone?: string | null;
  pairingExpiresAt?: number | null;
  waState?: string | null;
  configured_number?: string | null;
  connected_wid?: string | null;
  connected_at?: string | null;
  gerant_id?: number;
};

function formatPairingCode(code: string) {
  const clean = code.replace(/[\s-]/g, "").toUpperCase();
  if (clean.length === 8) return `${clean.slice(0, 4)}-${clean.slice(4)}`;
  return clean;
}

function digitsOnly(value: string) {
  return value.replace(/\D/g, "");
}

function toDisplayPhone(raw?: string | null) {
  const d = digitsOnly(raw || "");
  if (d.length === 12 && d.startsWith("221")) {
    return `+${d.slice(0, 3)} ${d.slice(3, 5)} ${d.slice(5, 8)} ${d.slice(8, 10)} ${d.slice(10)}`;
  }
  return raw || "";
}

function normalizeInputPhone(raw: string) {
  let d = digitsOnly(raw);
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 10 && d.startsWith("07")) d = d.slice(1);
  if (d.length === 9 && d.startsWith("7")) d = `221${d}`;
  return d;
}

function localPhoneForInput(raw?: string | null) {
  const d = digitsOnly(raw || "");
  if (d.startsWith("221") && d.length === 12) return d.slice(3);
  return d;
}

function openWhatsAppApp() {
  window.location.href = "whatsapp://";
  window.setTimeout(() => {
    window.open("https://wa.me/", "_blank", "noopener,noreferrer");
  }, 600);
}

export default function WhatsAppGerantCard() {
  const [status, setStatus] = useState<WaStatus | null>(null);
  const [phoneInput, setPhoneInput] = useState("");
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(Date.now());
  const wasConnected = useRef(false);

  const connected = Boolean(status?.connected || status?.status === "CONNECTED");
  const mock = Boolean(status?.mock);
  const connectionLabel = connected
    ? "CONNECTED"
    : pairingCode || status?.status === "CONNECTING" || status?.initializing
      ? "CONNECTING"
      : "DISCONNECTED";

  const linkedPhone = useMemo(
    () => status?.phone || status?.connected_wid || status?.pairingPhone || status?.configured_number || null,
    [status],
  );

  const secondsLeft = expiresAt ? Math.max(0, Math.ceil((expiresAt - now) / 1000)) : null;
  const codeExpired = Boolean(pairingCode && secondsLeft === 0);

  const refresh = useCallback(async () => {
    try {
      const data = (await gerantApi.whatsappStatus()) as WaStatus;
      setStatus(data);
      if (data.connected || data.status === "CONNECTED") {
        setPairingCode(null);
        setExpiresAt(null);
        return data;
      }
      if (data.pairingCode) {
        setPairingCode(formatPairingCode(data.pairingCodeDisplay || data.pairingCode));
        if (data.pairingExpiresAt) setExpiresAt(Number(data.pairingExpiresAt));
      }
      return data;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    refresh().then((data) => {
      if (cancelled) return;
      if (data?.configured_number) {
        setPhoneInput(localPhoneForInput(data.configured_number));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  useEffect(() => {
    if (connected) return;
    const timer = window.setInterval(() => {
      void refresh();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [refresh, connected]);

  useEffect(() => {
    if (!expiresAt || connected) return;
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(tick);
  }, [expiresAt, connected]);

  useEffect(() => {
    if (connected && !wasConnected.current) {
      toast.success("WhatsApp connecté et actif");
    }
    wasConnected.current = connected;
  }, [connected]);

  const requestPairing = async (force = true) => {
    const normalized = normalizeInputPhone(phoneInput);
    if (!/^2217\d{8}$/.test(normalized)) {
      toast.error("Numéro invalide. Exemple : 77 123 45 67");
      return;
    }
    setBusy(true);
    try {
      const data = (await gerantApi.whatsappRequestPairing({
        telephone: normalized,
        force,
      })) as WaStatus & { success?: boolean; pairingCodeRaw?: string };
      setStatus((prev) => ({ ...prev, ...data }));
      if (data.mock) {
        setPairingCode(null);
        toast.error(WHATSAPP_INFRA_MESSAGE);
        return;
      }
      if (data.connected || data.status === "CONNECTED") {
        setPairingCode(null);
        setExpiresAt(null);
        toast.success("WhatsApp déjà connecté");
        return;
      }
      const code = data.pairingCodeDisplay || data.pairingCode;
      if (!code) {
        toast.error(data.error || "Impossible de générer le code. Réessayez.");
        return;
      }
      setPairingCode(formatPairingCode(code));
      setExpiresAt(data.pairingExpiresAt ? Number(data.pairingExpiresAt) : Date.now() + 110_000);
      toast.success("Code généré — valable environ 2 minutes");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : WHATSAPP_INFRA_MESSAGE);
    } finally {
      setBusy(false);
    }
  };

  const copyCode = async () => {
    if (!pairingCode) return;
    const raw = pairingCode.replace(/-/g, "");
    try {
      await navigator.clipboard.writeText(raw);
      setCopied(true);
      toast.success("Code copié");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Copie impossible — notez le code à la main");
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      await gerantApi.whatsappDisconnect();
      setPairingCode(null);
      setExpiresAt(null);
      await refresh();
      toast.success("WhatsApp déconnecté");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Déconnexion impossible");
    } finally {
      setBusy(false);
    }
  };

  const badgeStyles =
    connectionLabel === "CONNECTED"
      ? { background: "rgba(37, 211, 102, 0.16)", color: "#128C7E" }
      : connectionLabel === "CONNECTING"
        ? { background: "rgba(234, 179, 8, 0.18)", color: "#a16207" }
        : { background: "rgba(220, 38, 38, 0.12)", color: "#dc2626" };

  const badgeText =
    connectionLabel === "CONNECTED"
      ? "WhatsApp Connecté & Actif"
      : connectionLabel === "CONNECTING"
        ? "Connexion en cours…"
        : "Non connecté";

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
            Lie ton numéro avec un code — aucun scan QR nécessaire sur le téléphone.
          </p>
        </div>
        <span
          className="shrink-0 text-xs font-bold px-3 py-1.5 rounded-full text-center max-w-[9.5rem] leading-tight"
          style={badgeStyles}
        >
          {badgeText}
        </span>
      </div>

      {connected ? (
        <div className="space-y-4">
          <div
            className="rounded-2xl p-4 space-y-2"
            style={{ background: "rgba(37, 211, 102, 0.12)", color: "#128C7E" }}
          >
            <p className="text-base font-semibold">WhatsApp Connecté & Actif</p>
            <p className="text-sm" style={{ color: "var(--g-text)" }}>
              Numéro : <strong>{toDisplayPhone(linkedPhone)}</strong>
            </p>
            {status?.connected_at ? (
              <p className="text-xs" style={{ color: "var(--g-muted)" }}>
                Dernière synchro :{" "}
                {new Date(status.connected_at).toLocaleString("fr-SN", {
                  day: "2-digit",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            ) : null}
            <p className="text-sm mt-1">Les messages du terrain partent depuis ton WhatsApp.</p>
          </div>
          <button
            type="button"
            onClick={disconnect}
            disabled={busy}
            className="w-full min-h-[48px] px-4 rounded-xl text-base font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-60"
            style={{ border: "1px solid var(--g-border)", color: "var(--g-text)" }}
          >
            {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Unplug className="w-5 h-5" />}
            Déconnecter / Changer de numéro
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {!pairingCode || codeExpired ? (
            <>
              <label className="block space-y-2">
                <span className="text-sm font-medium" style={{ color: "var(--g-text)" }}>
                  Ton numéro WhatsApp
                </span>
                <div
                  className="flex items-center gap-2 rounded-xl px-3 min-h-[52px]"
                  style={{ background: "var(--g-surface-2)", border: "1px solid var(--g-border)" }}
                >
                  <span className="text-sm font-semibold shrink-0" style={{ color: "var(--g-muted)" }}>
                    +221
                  </span>
                  <input
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel"
                    placeholder="77 123 45 67"
                    value={phoneInput}
                    onChange={(e) => setPhoneInput(e.target.value)}
                    className="flex-1 min-w-0 bg-transparent outline-none text-base py-3"
                    style={{ color: "var(--g-text)" }}
                    disabled={busy || mock}
                  />
                </div>
              </label>

              <button
                type="button"
                onClick={() => requestPairing(true)}
                disabled={busy || mock}
                className="w-full min-h-[56px] px-4 rounded-xl bg-[#25D366] text-white text-base font-bold inline-flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <MessageCircle className="w-5 h-5" />}
                {busy
                  ? "Génération du code…"
                  : codeExpired
                    ? "Générer un nouveau code"
                    : "Générer mon Code de Connexion"}
              </button>
            </>
          ) : null}

          {pairingCode && !codeExpired ? (
            <div
              className="rounded-2xl p-4 space-y-4 text-center"
              style={{
                background: "rgba(37, 211, 102, 0.1)",
                border: "1px solid rgba(37, 211, 102, 0.35)",
              }}
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-[#128C7E]">Code de jumelage</p>
              <p
                className="text-4xl font-bold tracking-[0.18em] select-all"
                style={{ fontFamily: "var(--font-display)", color: "var(--g-text)" }}
              >
                {pairingCode}
              </p>
              {secondsLeft != null ? (
                <p className="text-sm" style={{ color: secondsLeft < 30 ? "#dc2626" : "var(--g-muted)" }}>
                  Expire dans {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")}
                </p>
              ) : null}

              <div className="grid grid-cols-1 gap-2">
                <button
                  type="button"
                  onClick={copyCode}
                  className="min-h-[48px] rounded-xl text-base font-semibold inline-flex items-center justify-center gap-2"
                  style={{
                    background: "var(--g-surface)",
                    border: "1px solid var(--g-border)",
                    color: "var(--g-text)",
                  }}
                >
                  {copied ? <Check className="w-5 h-5 text-[#25D366]" /> : <Copy className="w-5 h-5" />}
                  {copied ? "Copié" : "Copier le code"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void copyCode();
                    openWhatsAppApp();
                  }}
                  className="min-h-[52px] rounded-xl bg-[#25D366] text-white text-base font-bold inline-flex items-center justify-center gap-2"
                >
                  <ExternalLink className="w-5 h-5" />
                  Ouvrir WhatsApp pour coller le code
                </button>
              </div>

              <ol className="text-left text-sm space-y-2 pt-1" style={{ color: "var(--g-muted)" }}>
                <li>
                  1. WhatsApp → <strong style={{ color: "var(--g-text)" }}>Paramètres</strong>
                </li>
                <li>
                  2. <strong style={{ color: "var(--g-text)" }}>Appareils connectés</strong>
                </li>
                <li>
                  3. <strong style={{ color: "var(--g-text)" }}>Lier un appareil</strong> →{" "}
                  <strong style={{ color: "var(--g-text)" }}>Lier avec un numéro de téléphone</strong>
                </li>
                <li>4. Colle le code ci-dessus</li>
              </ol>

              {(status?.waState === "authenticating" ||
                status?.waState === "restarting" ||
                status?.initializing) && (
                <p
                  className="text-sm inline-flex items-center justify-center gap-2"
                  style={{ color: "var(--g-muted)" }}
                >
                  <Loader2 className="w-4 h-4 animate-spin" />
                  En attente de validation sur WhatsApp…
                </p>
              )}

              <button
                type="button"
                onClick={() => requestPairing(true)}
                disabled={busy}
                className="text-sm font-medium underline underline-offset-2 disabled:opacity-60"
                style={{ color: "var(--g-muted)" }}
              >
                Régénérer le code
              </button>
              <button
                type="button"
                onClick={() => {
                  setPairingCode(null);
                  setExpiresAt(null);
                }}
                className="block mx-auto text-sm font-medium underline underline-offset-2"
                style={{ color: "var(--g-muted)" }}
              >
                Changer de numéro
              </button>
            </div>
          ) : null}

          {codeExpired ? (
            <p className="text-sm text-center" style={{ color: "#dc2626" }}>
              Le code a expiré (valable ~2 min). Génère-en un nouveau.
            </p>
          ) : null}
        </div>
      )}

      {mock ? (
        <p className="rounded-xl p-3 text-sm" style={{ background: "var(--g-surface-2)", color: "var(--g-muted)" }}>
          {WHATSAPP_INFRA_MESSAGE}
        </p>
      ) : null}

      {status?.error && !mock && !connected ? (
        <p className="rounded-xl p-3 text-sm" style={{ background: "rgba(220,38,38,0.08)", color: "#dc2626" }}>
          {status.error}
        </p>
      ) : null}
    </section>
  );
}
