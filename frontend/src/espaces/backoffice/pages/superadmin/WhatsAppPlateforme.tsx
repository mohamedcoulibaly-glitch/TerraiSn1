import { useCallback, useEffect, useState } from "react";
import { Loader2, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { superAdminApi } from "@/services/superAdminApi";
import { useSaCrumbs } from "@/espaces/backoffice/layout/SuperadminLayout";
import SaPageHeader from "@/espaces/backoffice/components/superadmin/ui/SaPageHeader";
import { ConfirmationModal } from "@/espaces/backoffice/components/superadmin/ConfirmationModal";

type Wa = {
  connected?: boolean;
  phone?: string | null;
  dataUrl?: string | null;
  initializing?: boolean;
};

export default function WhatsAppPlateformePage() {
  useSaCrumbs([{ label: "Paramètres" }, { label: "WhatsApp" }]);
  const [status, setStatus] = useState<Wa | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const [testTel, setTestTel] = useState("");
  const [modal, setModal] = useState(false);

  const refresh = useCallback(async () => {
    const s = (await superAdminApi.whatsappStatus()) as Wa;
    setStatus(s);
    if (!s.connected) {
      const q = (await superAdminApi.whatsappQr()) as Wa;
      setQr(q.dataUrl || null);
      setStatus((p) => ({ ...p, ...q }));
    } else setQr(null);
  }, []);

  useEffect(() => {
    refresh().catch(() => {});
    const t = window.setInterval(() => refresh().catch(() => {}), 4000);
    return () => window.clearInterval(t);
  }, [refresh]);

  async function connect(force = false) {
    setBusy(true);
    try {
      const data = (await superAdminApi.whatsappConnect(force)) as Wa;
      setStatus(data);
      setQr(data.dataUrl || null);
      setModal(true);
      if (data.connected) {
        setModal(false);
        toast.success("WhatsApp connecté ✓");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Connexion impossible");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (status?.connected && modal) {
      setModal(false);
      toast.success("WhatsApp connecté ✓");
    }
  }, [status?.connected, modal]);

  return (
    <div className="max-w-xl space-y-4">
      <SaPageHeader titre="WhatsApp plateforme" sousTitre="Numéro dédié aux notifications joueurs et gérants" />
      <section className="rounded-xl p-5 space-y-3" style={{ background: "var(--sa-surface)", borderTop: "3px solid #25D366", boxShadow: "var(--sa-shadow)" }}>
        <div className="flex items-center gap-2">
          <MessageCircle size={18} style={{ color: "#25D366" }} />
          <span className="text-[13px] font-semibold" style={{ color: "var(--sa-text)" }}>WhatsApp Plateforme</span>
        </div>
        {status?.connected ? (
          <>
            <p className="text-sm font-semibold inline-flex items-center gap-2" style={{ color: "var(--sa-success)" }}>
              <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: "var(--sa-success)" }} />
              WhatsApp connecté ✓
            </p>
            {status.phone ? <p className="text-sm" style={{ color: "var(--sa-text)" }}>+{status.phone}</p> : null}
            <button type="button" onClick={() => setConfirmOff(true)} className="min-h-[44px] px-4 rounded-lg text-[13px] font-semibold" style={{ border: "1px solid var(--sa-danger)", color: "var(--sa-danger)" }}>Déconnecter</button>
          </>
        ) : (
          <>
            <p className="text-sm font-semibold" style={{ color: "var(--sa-danger)" }}>WhatsApp déconnecté</p>
            <p className="text-[13px]" style={{ color: "var(--sa-muted)" }}>Les notifications joueurs, gérants et alertes de reversement sont suspendues.</p>
            <button type="button" disabled={busy} onClick={() => connect(false)} className="min-h-[44px] px-4 rounded-lg text-[13px] font-semibold text-white inline-flex items-center gap-2" style={{ background: "#25D366" }}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : null}
              Reconnecter WhatsApp
            </button>
          </>
        )}
      </section>

      <section className="rounded-xl p-5 space-y-2" style={{ background: "var(--sa-surface)", boxShadow: "var(--sa-shadow)" }}>
        <h2 className="text-[14px] font-semibold" style={{ color: "var(--sa-text)" }}>Numéro dédié</h2>
        <p className="text-[12px]" style={{ color: "var(--sa-muted)" }}>Utilisez un numéro WhatsApp dédié à la plateforme, séparé de votre numéro personnel.</p>
        <p className="text-sm font-medium" style={{ color: "var(--sa-text)" }}>{status?.phone ? `+${status.phone}` : "Aucun"}</p>
        <button type="button" onClick={() => connect(true)} className="text-[12px] font-semibold" style={{ color: "var(--sa-primary)" }}>Changer de numéro</button>
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

      {modal && qr ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <button type="button" className="absolute inset-0" style={{ background: "rgba(10,22,40,0.5)" }} onClick={() => setModal(false)} />
          <div className="relative rounded-2xl p-5 w-full max-w-sm text-center space-y-3" style={{ background: "var(--sa-surface)" }}>
            <h3 className="font-semibold" style={{ color: "var(--sa-text)" }}>Scanner le QR code avec WhatsApp</h3>
            <p className="text-[12px]" style={{ color: "var(--sa-muted)" }}>Paramètres → Appareils liés → Scanner ce QR</p>
            <img src={qr} alt="QR plateforme" className="w-[200px] h-[200px] mx-auto rounded-xl bg-white p-4" />
            <button type="button" onClick={() => connect(true)} className="text-[12px] font-semibold" style={{ color: "var(--sa-primary)" }}>Rafraîchir le QR</button>
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
          await refresh();
        }}
      />
    </div>
  );
}
