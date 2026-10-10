import { useCallback, useEffect, useState } from "react";
import { Loader2, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { superAdminApi } from "@/services/superAdminApi";
import { useSaCrumbs } from "@/espaces/backoffice/layout/SuperadminLayout";
import SaPageHeader from "@/espaces/backoffice/components/superadmin/ui/SaPageHeader";
import { ConfirmationModal } from "@/espaces/backoffice/components/superadmin/ConfirmationModal";

type Wa = {
  connected?: boolean;
  ready?: boolean;
  phone?: string | null;
  dataUrl?: string | null;
  initializing?: boolean;
  pairingCode?: string | null;
  pairingPhone?: string | null;
  changingNumber?: boolean;
  error?: string | null;
  openwaSessionId?: string | null;
};

function digitsOnly(value: string) {
  return String(value || "").replace(/\D/g, "");
}

function normalizeSnPhone(raw: string) {
  let d = digitsOnly(raw);
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 10 && d.startsWith("0")) d = d.slice(1);
  if (d.length === 9 && d.startsWith("7")) d = `221${d}`;
  return d;
}

function formatPairingCode(code: string) {
  const clean = code.replace(/[\s-]/g, "").toUpperCase();
  if (clean.length === 8) return `${clean.slice(0, 4)}-${clean.slice(4)}`;
  return clean;
}

function displayPhone(raw?: string | null) {
  const d = digitsOnly(raw || "");
  if (d.length === 12 && d.startsWith("221")) {
    return `+${d.slice(0, 3)} ${d.slice(3, 5)} ${d.slice(5, 8)} ${d.slice(8, 10)} ${d.slice(10)}`;
  }
  if (!d) return null;
  return `+${d}`;
}

export default function WhatsAppPlateformePage() {
  useSaCrumbs([{ label: "Paramètres" }, { label: "WhatsApp" }]);
  const [status, setStatus] = useState<Wa | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const [testTel, setTestTel] = useState("");
  const [modal, setModal] = useState(false);
  const [senderPhone, setSenderPhone] = useState("");
  const [changing, setChanging] = useState(false);

  const connected = Boolean(status?.connected || status?.ready);

  const refresh = useCallback(async () => {
    const s = (await superAdminApi.whatsappStatus()) as Wa;
    setStatus(s);
    if (s.connected || s.ready) {
      setQr(null);
      setPairingCode(null);
      setChanging(false);
      setModal(false);
      return;
    }
    const q = (await superAdminApi.whatsappQr()) as Wa;
    setQr(q.dataUrl || null);
    if (q.pairingCode) setPairingCode(formatPairingCode(q.pairingCode));
    setStatus((p) => ({ ...p, ...q }));
    if (q.changingNumber || q.dataUrl || q.pairingCode) {
      setChanging(true);
      setModal(true);
    }
  }, []);

  useEffect(() => {
    refresh().catch(() => {});
    const t = window.setInterval(() => refresh().catch(() => {}), 4000);
    return () => window.clearInterval(t);
  }, [refresh]);

  async function connect(opts: { force?: boolean; changeNumber?: boolean; telephone?: string } = {}) {
    setBusy(true);
    try {
      const data = (await superAdminApi.whatsappConnect(Boolean(opts.force || opts.changeNumber), {
        changeNumber: opts.changeNumber ?? opts.force,
        telephone: opts.telephone,
      })) as Wa;
      setStatus(data);
      setQr(data.dataUrl || null);
      setPairingCode(data.pairingCode ? formatPairingCode(data.pairingCode) : null);
      if (data.connected || data.ready) {
        setModal(false);
        setChanging(false);
        toast.success(
          data.phone
            ? `WhatsApp connecté : ${displayPhone(data.phone)}`
            : "WhatsApp connecté ✓",
        );
      } else {
        setChanging(Boolean(opts.changeNumber || opts.force));
        setModal(true);
        if (data.pairingCode) {
          toast.message("Code d’appairage généré — validez-le dans WhatsApp");
        } else if (data.dataUrl) {
          toast.message("Scannez le QR avec le nouveau numéro");
        } else {
          toast.error(data.error || "QR / code indisponible");
        }
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Connexion impossible");
    } finally {
      setBusy(false);
    }
  }

  async function changeSenderNumber() {
    const normalized = senderPhone.trim() ? normalizeSnPhone(senderPhone) : "";
    if (normalized && !/^2217\d{8}$/.test(normalized)) {
      toast.error("Numéro invalide. Exemple : 77 826 12 25");
      return;
    }
    setChanging(true);
    await connect({
      force: true,
      changeNumber: true,
      telephone: normalized || undefined,
    });
  }

  useEffect(() => {
    if (connected && modal) {
      setModal(false);
      setChanging(false);
      toast.success(
        status?.phone
          ? `WhatsApp connecté : ${displayPhone(status.phone)}`
          : "WhatsApp connecté ✓",
      );
    }
  }, [connected, modal, status?.phone]);

  return (
    <div className="max-w-xl space-y-4">
      <SaPageHeader titre="WhatsApp plateforme" sousTitre="Numéro dédié aux notifications joueurs et gérants" />
      <section className="rounded-xl p-5 space-y-3" style={{ background: "var(--sa-surface)", borderTop: "3px solid #25D366", boxShadow: "var(--sa-shadow)" }}>
        <div className="flex items-center gap-2">
          <MessageCircle size={18} style={{ color: "#25D366" }} />
          <span className="text-[13px] font-semibold" style={{ color: "var(--sa-text)" }}>WhatsApp Plateforme</span>
        </div>
        {connected ? (
          <>
            <p className="text-sm font-semibold inline-flex items-center gap-2" style={{ color: "var(--sa-success)" }}>
              <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: "var(--sa-success)" }} />
              WhatsApp connecté ✓
            </p>
            {status?.phone ? <p className="text-sm" style={{ color: "var(--sa-text)" }}>{displayPhone(status.phone)}</p> : null}
            <button type="button" onClick={() => setConfirmOff(true)} className="min-h-[44px] px-4 rounded-lg text-[13px] font-semibold" style={{ border: "1px solid var(--sa-danger)", color: "var(--sa-danger)" }}>Déconnecter</button>
          </>
        ) : (
          <>
            <p className="text-sm font-semibold" style={{ color: "var(--sa-danger)" }}>
              {changing ? "Changement de numéro en cours…" : "WhatsApp déconnecté"}
            </p>
            <p className="text-[13px]" style={{ color: "var(--sa-muted)" }}>
              {changing
                ? "Scannez le QR ou validez le code d’appairage avec le nouveau numéro émetteur."
                : "Les notifications joueurs, gérants et alertes de reversement sont suspendues."}
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() => void connect({ force: false })}
              className="min-h-[44px] px-4 rounded-lg text-[13px] font-semibold text-white inline-flex items-center gap-2"
              style={{ background: "#25D366" }}
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : null}
              Reconnecter WhatsApp
            </button>
          </>
        )}
      </section>

      <section className="rounded-xl p-5 space-y-3" style={{ background: "var(--sa-surface)", boxShadow: "var(--sa-shadow)" }}>
        <h2 className="text-[14px] font-semibold" style={{ color: "var(--sa-text)" }}>Numéro émetteur</h2>
        <p className="text-[12px]" style={{ color: "var(--sa-muted)" }}>
          Indiquez le nouveau numéro WhatsApp à lier, puis validez. Un QR et/ou un code d’appairage seront générés.
          L’ancien numéro cessera d’envoyer les notifications.
        </p>
        <p className="text-sm font-medium" style={{ color: "var(--sa-text)" }}>
          Actuel : {status?.phone ? displayPhone(status.phone) : "Aucun"}
        </p>
        <label className="block space-y-1">
          <span className="text-[12px] font-semibold" style={{ color: "var(--sa-text)" }}>
            Nouveau numéro (Sénégal)
          </span>
          <input
            className="w-full h-11 rounded-lg px-3 text-sm"
            placeholder="77 826 12 25"
            value={senderPhone}
            onChange={(e) => setSenderPhone(e.target.value)}
            style={{ border: "1px solid var(--sa-border)" }}
            inputMode="tel"
            autoComplete="tel"
          />
        </label>
        <button
          type="button"
          disabled={busy}
          onClick={() => void changeSenderNumber()}
          className="min-h-[44px] px-4 rounded-lg text-[13px] font-semibold text-white inline-flex items-center gap-2 disabled:opacity-50"
          style={{ background: "var(--sa-primary)" }}
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : null}
          Changer de numéro
        </button>
      </section>

      <section className="rounded-xl p-5 space-y-2" style={{ background: "var(--sa-surface)", boxShadow: "var(--sa-shadow)" }}>
        <h2 className="text-[14px] font-semibold" style={{ color: "var(--sa-text)" }}>Test de notification</h2>
        <input className="w-full h-11 rounded-lg px-3 text-sm" placeholder="2217XXXXXXXX" value={testTel} onChange={(e) => setTestTel(e.target.value)} style={{ border: "1px solid var(--sa-border)" }} />
        <button
          type="button"
          onClick={async () => {
            try {
              await superAdminApi.whatsappTest(testTel);
              toast.success("Message envoyé ✓");
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Échec");
            }
          }}
          className="min-h-[44px] px-4 rounded-lg text-[13px] font-semibold text-white"
          style={{ background: "var(--sa-primary)" }}
        >
          Envoyer un message test
        </button>
      </section>

      <section className="rounded-xl p-5 space-y-2" style={{ background: "var(--sa-surface)", boxShadow: "var(--sa-shadow)" }}>
        <h2 className="text-[14px] font-semibold" style={{ color: "var(--sa-text)" }}>Alertes développeur</h2>
        <p className="text-[12px]" style={{ color: "var(--sa-muted)" }}>
          E-mail + WhatsApp (session plateforme) vers les devs en cas de bug ou panne OpenWA.
          Le WhatsApp d’alerte utilise le numéro connecté ci-dessus.
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const r = (await superAdminApi.bugAlertsTest()) as {
                ok?: boolean;
                email?: { ok?: boolean };
                whatsapp?: { ok?: boolean; reason?: string };
              };
              if (r.email?.ok) toast.success("E-mail d’alerte envoyé ✓");
              else toast.error("E-mail d’alerte échoué");
              if (r.whatsapp?.ok) toast.success("WhatsApp d’alerte envoyé ✓");
              else if (r.whatsapp?.reason === "platform_whatsapp_disconnected") {
                toast.message("WhatsApp alerte : connecte d’abord la session plateforme");
              } else toast.message("WhatsApp alerte non envoyé");
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Échec test alerte");
            } finally {
              setBusy(false);
            }
          }}
          className="min-h-[44px] px-4 rounded-lg text-[13px] font-semibold"
          style={{ border: "1px solid var(--sa-border)", color: "var(--sa-text)" }}
        >
          Tester les alertes développeur
        </button>
      </section>

      {modal && (qr || pairingCode) ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <button type="button" className="absolute inset-0" style={{ background: "rgba(10,22,40,0.5)" }} onClick={() => setModal(false)} />
          <div className="relative rounded-2xl p-5 w-full max-w-sm text-center space-y-3" style={{ background: "var(--sa-surface)" }}>
            <h3 className="font-semibold" style={{ color: "var(--sa-text)" }}>
              {changing ? "Lier le nouveau numéro WhatsApp" : "Scanner le QR code avec WhatsApp"}
            </h3>
            {pairingCode ? (
              <div className="space-y-2">
                <p className="text-[12px]" style={{ color: "var(--sa-muted)" }}>
                  WhatsApp → Appareils liés → Lier un appareil → « Lier avec un numéro de téléphone »
                  {status?.pairingPhone || senderPhone
                    ? ` · ${displayPhone(status?.pairingPhone || normalizeSnPhone(senderPhone))}`
                    : ""}
                </p>
                <p className="text-3xl font-bold tracking-widest" style={{ color: "var(--sa-text)" }}>
                  {pairingCode}
                </p>
              </div>
            ) : null}
            {qr ? (
              <>
                <p className="text-[12px]" style={{ color: "var(--sa-muted)" }}>
                  Paramètres → Appareils liés → Scanner ce QR avec le nouveau numéro
                </p>
                <img src={qr} alt="QR plateforme" className="w-[200px] h-[200px] mx-auto rounded-xl bg-white p-4" />
              </>
            ) : null}
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void connect({
                  force: true,
                  changeNumber: true,
                  telephone: senderPhone.trim() ? normalizeSnPhone(senderPhone) : undefined,
                })
              }
              className="text-[12px] font-semibold disabled:opacity-50"
              style={{ color: "var(--sa-primary)" }}
            >
              {busy ? "Préparation…" : "Rafraîchir QR / code"}
            </button>
          </div>
        </div>
      ) : null}

      <ConfirmationModal
        ouvert={confirmOff}
        titre="Déconnecter WhatsApp ?"
        texte="Les notifications seront suspendues."
        variante="warning"
        onAnnuler={() => setConfirmOff(false)}
        onConfirmer={async () => {
          await superAdminApi.whatsappDisconnect();
          setConfirmOff(false);
          setChanging(false);
          await refresh();
        }}
      />
    </div>
  );
}
