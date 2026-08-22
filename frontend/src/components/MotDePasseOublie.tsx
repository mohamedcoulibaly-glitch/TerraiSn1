import { useEffect, useState } from "react";
import { Eye, EyeOff, Check, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { authApi } from "@/lib/api";
import { formatPhoneDisplay, phoneError, toLocal9 } from "@/auth/phone";
import { forceMotDePasse, messageErreurAuth } from "@/auth/loginErrors";
import FloatingInput from "@/components/FloatingInput";
import BoutonSoumettre from "@/components/BoutonSoumettre";
import OtpCases from "@/components/OtpCases";
import IndicateurForceMdp from "@/components/IndicateurForceMdp";

type Etape = 1 | 2 | 3;

interface MotDePasseOublieProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  theme: "joueur" | "backoffice";
  telephoneInitial?: string;
  onSucces?: () => void;
}

export default function MotDePasseOublie({
  open,
  onOpenChange,
  theme,
  telephoneInitial = "",
  onSucces,
}: MotDePasseOublieProps) {
  const [etape, setEtape] = useState<Etape>(1);
  const [telephone, setTelephone] = useState("");
  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [erreur, setErreur] = useState("");
  const [timer, setTimer] = useState(30);

  const text = theme === "joueur" ? "var(--lj-text)" : "var(--lb-text)";
  const muted = theme === "joueur" ? "var(--lj-muted)" : "var(--lb-muted)";
  const sheet = theme === "joueur" ? "var(--lj-sheet-bg)" : "var(--lb-sheet-bg)";
  const primary = theme === "joueur" ? "var(--lj-primary)" : "var(--lb-primary)";
  const errorColor = theme === "joueur" ? "var(--lj-error)" : "var(--lb-error)";

  useEffect(() => {
    if (!open) return;
    setEtape(1);
    setTelephone(telephoneInitial ? formatPhoneDisplay(telephoneInitial) : "");
    setOtp("");
    setPassword("");
    setConfirm("");
    setErreur("");
    setSubmitting(false);
    setTimer(30);
  }, [open, telephoneInitial]);

  useEffect(() => {
    if (!open || etape !== 2) return;
    setTimer(30);
    const id = window.setInterval(() => {
      setTimer((n) => (n <= 1 ? 0 : n - 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, [open, etape]);

  if (!open) return null;

  const fermer = () => {
    if (submitting) return;
    onOpenChange(false);
  };

  const envoyerCode = async () => {
    const err = phoneError(telephone);
    if (err) {
      setErreur(err);
      return;
    }
    setSubmitting(true);
    setErreur("");
    try {
      await authApi.resendOtp(toLocal9(telephone));
      setEtape(2);
      setOtp("");
      setTimer(30);
    } catch (e) {
      setErreur(messageErreurAuth(e, "forgot"));
    } finally {
      setSubmitting(false);
    }
  };

  const renvoyer = async () => {
    if (timer > 0 || submitting) return;
    setSubmitting(true);
    setErreur("");
    try {
      await authApi.resendOtp(toLocal9(telephone));
      setTimer(30);
    } catch (e) {
      setErreur(messageErreurAuth(e, "forgot"));
    } finally {
      setSubmitting(false);
    }
  };

  const verifierOtp = async () => {
    const code = otp.replace(/\D/g, "");
    if (code.length !== 6) {
      setErreur("Saisissez le code à 6 chiffres");
      return;
    }
    setSubmitting(true);
    setErreur("");
    try {
      await authApi.verifyOtp({ telephone: toLocal9(telephone), code });
      setEtape(3);
    } catch (e) {
      setErreur(messageErreurAuth(e, "otp"));
    } finally {
      setSubmitting(false);
    }
  };

  const enregistrer = async () => {
    if (password.length < 6) {
      setErreur("Minimum 6 caractères");
      return;
    }
    if (password !== confirm) {
      setErreur("Les mots de passe ne correspondent pas");
      return;
    }
    setSubmitting(true);
    setErreur("");
    try {
      await authApi.changePassword(password);
      await authApi.logout();
      toast.success("Mot de passe mis à jour ✓");
      onOpenChange(false);
      onSucces?.();
    } catch (e) {
      setErreur(messageErreurAuth(e, "forgot"));
    } finally {
      setSubmitting(false);
    }
  };

  const local = formatPhoneDisplay(telephone);

  return (
    <div className="fixed inset-0 z-50 [grid-column:1/-1]">
      <button
        type="button"
        aria-label="Fermer"
        className="absolute inset-0 bg-black/40"
        onClick={fermer}
      />
      <div
        className="absolute bottom-0 left-0 right-0 rounded-t-[28px] px-6 pt-3 pb-[max(24px,env(safe-area-inset-bottom))] max-h-[90dvh] overflow-y-auto"
        style={{ background: sheet, color: text }}
      >
        <div
          className="w-10 h-1 rounded-full mx-auto mb-5"
          style={{ background: theme === "joueur" ? "var(--lj-border)" : "var(--lb-border)" }}
        />
        <h2 className="text-[18px] font-bold" style={{ fontFamily: "var(--font-display)", color: text }}>
          Récupère ton accès
        </h2>
        <p className="text-[13px] mt-1 mb-6" style={{ color: muted }}>
          On t&apos;envoie un code sur ton WhatsApp
        </p>

        {etape === 1 && (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void envoyerCode();
            }}
          >
            <FloatingInput
              id="forgot-phone"
              label="Ton numéro de téléphone"
              theme={theme}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={telephone}
              onChange={(v) => {
                setTelephone(formatPhoneDisplay(v));
                setErreur("");
              }}
              iconeGauche={<span className="text-sm">+221</span>}
            />
            <BoutonSoumettre
              theme={theme}
              label="Envoyer le code"
              labelLoading="Envoi en cours..."
              loading={submitting}
              onClick={() => {}}
            />
            {erreur ? (
              <p className="flex items-center gap-2 text-[13px] animate-[login-fade-in_0.2s_ease]" style={{ color: errorColor }}>
                <AlertCircle className="w-4 h-4 shrink-0" />
                {erreur}
              </p>
            ) : null}
          </form>
        )}

        {etape === 2 && (
          <form
            className="flex flex-col gap-4 animate-[login-slide-left_0.25s_ease]"
            onSubmit={(e) => {
              e.preventDefault();
              void verifierOtp();
            }}
          >
            <p className="text-[12px]" style={{ color: muted }}>
              On t&apos;a envoyé un code au +221 {local}
            </p>
            <OtpCases theme={theme} value={otp} onChange={(v) => { setOtp(v); setErreur(""); }} />
            {timer > 0 ? (
              <p className="text-[13px] text-center" style={{ color: muted }}>
                Renvoyer le code dans {timer}s
              </p>
            ) : (
              <button
                type="button"
                onClick={() => void renvoyer()}
                className="text-[13px] text-center font-medium min-h-[44px]"
                style={{ color: primary }}
              >
                Renvoyer le code
              </button>
            )}
            <BoutonSoumettre
              theme={theme}
              label="Vérifier"
              labelLoading="Vérification..."
              loading={submitting}
              onClick={() => {}}
            />
            {erreur ? (
              <p className="flex items-center gap-2 text-[13px] animate-[login-fade-in_0.2s_ease]" style={{ color: errorColor }}>
                <AlertCircle className="w-4 h-4 shrink-0" />
                {erreur}
              </p>
            ) : null}
          </form>
        )}

        {etape === 3 && (
          <form
            className="flex flex-col gap-4 animate-[login-slide-left_0.25s_ease]"
            onSubmit={(e) => {
              e.preventDefault();
              void enregistrer();
            }}
          >
            <FloatingInput
              id="forgot-pass"
              label="Nouveau mot de passe"
              theme={theme}
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              value={password}
              onChange={(v) => {
                setPassword(v);
                setErreur("");
              }}
              iconeDroite={showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              onIconeDroiteClick={() => setShowPassword((s) => !s)}
            />
            <IndicateurForceMdp password={password} theme={theme} />
            <FloatingInput
              id="forgot-confirm"
              label="Confirmer le mot de passe"
              theme={theme}
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              value={confirm}
              onChange={(v) => {
                setConfirm(v);
                setErreur("");
              }}
              succes={!!confirm && confirm === password && forceMotDePasse(password) !== "empty"}
              iconeDroite={
                confirm && confirm === password ? <Check className="w-4 h-4" /> : undefined
              }
            />
            <BoutonSoumettre
              theme={theme}
              label="Enregistrer"
              labelLoading="Enregistrement..."
              loading={submitting}
              onClick={() => {}}
            />
            {erreur ? (
              <p className="flex items-center gap-2 text-[13px] animate-[login-fade-in_0.2s_ease]" style={{ color: errorColor }}>
                <AlertCircle className="w-4 h-4 shrink-0" />
                {erreur}
              </p>
            ) : null}
          </form>
        )}

        <button
          type="button"
          onClick={fermer}
          className="w-full mt-3 min-h-[44px] text-[13px] font-medium"
          style={{ color: muted }}
        >
          Fermer
        </button>
      </div>
    </div>
  );
}
