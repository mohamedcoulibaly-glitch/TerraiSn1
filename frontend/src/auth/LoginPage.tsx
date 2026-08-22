import { useEffect, useState, type HTMLAttributes } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { AlertCircle, Check, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { authApi } from "@/lib/api";
import { homeForUser, normalizeRole } from "@/auth/roles";
import { formatPhoneDisplay, isValidSenegalMobile, phoneError, toLocal9 } from "@/auth/phone";
import { messageErreurAuth } from "@/auth/loginErrors";
import FloatingInput from "@/components/FloatingInput";
import BoutonSoumettre from "@/components/BoutonSoumettre";
import OtpCases from "@/components/OtpCases";
import IndicateurForceMdp from "@/components/IndicateurForceMdp";
import MotDePasseOublie from "@/components/MotDePasseOublie";
import LoginHeroVideo from "@/components/LoginHeroVideo";

type Tab = "login" | "register";
type Step = "form" | "otp";

/**
 * /login — espace joueur uniquement.
 * Onglets Connexion / Inscription + vérification OTP WhatsApp.
 */
export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, setSession, isAuthenticated, user, loading } = useAuth();

  const from = (location.state as { from?: { pathname?: string; search?: string } })?.from;
  const redirectTo =
    from?.pathname && from.pathname !== "/login"
      ? `${from.pathname}${from.search || ""}`
      : "/";

  const [tab, setTab] = useState<Tab>("login");
  const [step, setStep] = useState<Step>("form");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const [otpTimer, setOtpTimer] = useState(30);

  const [loginForm, setLoginForm] = useState({ identifier: "", password: "" });
  const [registerForm, setRegisterForm] = useState({
    prenom: "",
    nom: "",
    telephone: "",
    password: "",
    confirm: "",
  });
  const [otpPhone, setOtpPhone] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (step !== "otp") return;
    setOtpTimer(30);
    const id = window.setInterval(() => {
      setOtpTimer((n) => (n <= 1 ? 0 : n - 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, [step]);

  if (!loading && isAuthenticated && user && !showForgot) {
    const role = normalizeRole(user);
    if (role && role !== "joueur") {
      return <Navigate to={homeForUser(user)} replace />;
    }
    return <Navigate to={redirectTo} replace />;
  }

  const onPhoneChange = (value: string, setter: (v: string) => void, field: string) => {
    const formatted = formatPhoneDisplay(value);
    setter(formatted);
    setErrors((e) => {
      const next = { ...e };
      delete next[field];
      return next;
    });
  };

  const onLoginIdentifierChange = (raw: string) => {
    if (raw.includes("@")) {
      setLoginForm((f) => ({ ...f, identifier: raw }));
    } else {
      const hasLetter = /[a-zA-Z]/.test(raw);
      setLoginForm((f) => ({ ...f, identifier: hasLetter ? raw : formatPhoneDisplay(raw) }));
    }
    setErrors((e) => {
      const next = { ...e };
      delete next.identifier;
      delete next.form;
      return next;
    });
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const nextErrors: Record<string, string> = {};
    const rawId = loginForm.identifier.trim();
    if (!rawId) {
      nextErrors.identifier = "Téléphone ou email requis";
    } else if (rawId.includes("@")) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawId)) {
        nextErrors.identifier = "Adresse email invalide";
      }
    } else {
      const phoneErr = phoneError(rawId);
      if (phoneErr) nextErrors.identifier = phoneErr;
    }
    if (!loginForm.password) nextErrors.password = "Mot de passe requis";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    const identifier = rawId.includes("@") ? rawId : toLocal9(rawId);

    setSubmitting(true);
    try {
      const connected = await login(identifier, loginForm.password);
      const role = normalizeRole(connected);
      if (role && role !== "joueur") {
        toast.success("Connexion réussie — redirection vers votre espace");
        navigate(homeForUser(connected), { replace: true });
        return;
      }
      if (connected?.must_change_password) {
        navigate("/changer-mot-de-passe");
        return;
      }
      toast.success("Connexion réussie");
      navigate(redirectTo, { replace: true });
    } catch (err: any) {
      if (err?.code === "OTP_REQUIRED" || /non vérifié|OTP/i.test(err?.message || "")) {
        setOtpPhone(formatPhoneDisplay(rawId.includes("@") ? err?.telephone || "" : rawId));
        setStep("otp");
        toast.message("Validez le code reçu sur WhatsApp");
        return;
      }
      setErrors({ form: messageErreurAuth(err, "joueur") });
    } finally {
      setSubmitting(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    const nextErrors: Record<string, string> = {};
    if (!registerForm.prenom.trim()) nextErrors.prenom = "Prénom requis";
    if (!registerForm.nom.trim()) nextErrors.nom = "Nom requis";
    const phoneErr = phoneError(registerForm.telephone);
    if (phoneErr) nextErrors.telephone = phoneErr;
    if (registerForm.password.length < 6) {
      nextErrors.password = "Minimum 6 caractères";
    }
    if (registerForm.password !== registerForm.confirm) {
      nextErrors.confirm = "Les mots de passe ne correspondent pas";
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    setSubmitting(true);
    try {
      const phone = toLocal9(registerForm.telephone);
      await authApi.registerJoueur({
        prenom: registerForm.prenom.trim(),
        nom: registerForm.nom.trim(),
        telephone: phone,
        password: registerForm.password,
      });
      setOtpPhone(formatPhoneDisplay(phone));
      setOtpCode("");
      setStep("otp");
      toast.success("Code envoyé sur WhatsApp");
    } catch (err: any) {
      setErrors({ form: messageErreurAuth(err, "joueur") });
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = otpCode.replace(/\D/g, "");
    if (code.length !== 6) {
      setErrors({ otp: "Saisissez le code à 6 chiffres" });
      return;
    }
    setSubmitting(true);
    setErrors({});
    try {
      const result = await authApi.verifyOtp({
        telephone: toLocal9(otpPhone),
        code,
      });
      setSession(result.user, result.token);
      toast.success("Compte vérifié");
      navigate(redirectTo, { replace: true });
    } catch (err: any) {
      setErrors({ otp: messageErreurAuth(err, "otp") });
    } finally {
      setSubmitting(false);
    }
  };

  const handleResend = async () => {
    if (otpTimer > 0 || resending) return;
    setResending(true);
    try {
      await authApi.resendOtp(toLocal9(otpPhone));
      setOtpTimer(30);
      toast.success("Nouveau code envoyé");
    } catch (err: any) {
      setErrors({ otp: messageErreurAuth(err, "otp") });
    } finally {
      setResending(false);
    }
  };

  const loginIsEmail = loginForm.identifier.includes("@");
  const loginHasLetter = /[a-zA-Z]/.test(loginForm.identifier);
  const loginInputMode: HTMLAttributes<HTMLInputElement>["inputMode"] = loginIsEmail
    ? "email"
    : loginHasLetter
      ? "text"
      : "tel";
  const phoneValid = !!registerForm.telephone && isValidSenegalMobile(registerForm.telephone);
  const passwordsMatch =
    !!registerForm.confirm && registerForm.password === registerForm.confirm;

  return (
    <div className="login-joueur">
      <div className="login-media">
        <LoginHeroVideo />
        <div className="login-bg-overlay" aria-hidden />
        <div className="login-brand">
          <p className="text-[22px] font-black tracking-tight text-white drop-shadow-md">
            TERRAIN<span className="text-[var(--lj-primary)]">.SN</span>
          </p>
          <p className="text-[13px] text-white/80 mt-1 drop-shadow">Réserve ton terrain en 2 minutes</p>
        </div>
      </div>

      <div className="login-sheet">
          {step === "otp" ? (
            <form
              onSubmit={handleVerifyOtp}
              className="flex flex-col gap-5 animate-[login-slide-left_0.25s_ease]"
            >
              <h2
                className="text-[18px] font-bold"
                style={{ fontFamily: "var(--font-display)", color: "var(--lj-text)" }}
              >
                Vérifie ton WhatsApp 📱
              </h2>
              <p className="text-[12px]" style={{ color: "var(--lj-muted)" }}>
                On t&apos;a envoyé un code au +221 {otpPhone}
              </p>

              <OtpCases
                theme="joueur"
                value={otpCode}
                onChange={(v) => {
                  setOtpCode(v);
                  setErrors((prev) => ({ ...prev, otp: "" }));
                }}
              />

              {otpTimer > 0 ? (
                <p className="text-[13px] text-center" style={{ color: "var(--lj-muted)" }}>
                  Renvoyer le code dans {otpTimer}s
                </p>
              ) : (
                <button
                  type="button"
                  disabled={resending}
                  onClick={() => void handleResend()}
                  className="text-[13px] text-center font-medium min-h-[44px] disabled:opacity-50"
                  style={{ color: "var(--lj-primary)" }}
                >
                  {resending ? "Envoi..." : "Renvoyer le code"}
                </button>
              )}

              <BoutonSoumettre
                theme="joueur"
                label="Vérifier"
                labelLoading="Vérification..."
                loading={submitting}
                onClick={() => {}}
              />
              {errors.otp ? (
                <p
                  className="flex items-center gap-2 text-[13px] animate-[login-fade-in_0.2s_ease]"
                  style={{ color: "var(--lj-error)" }}
                >
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {errors.otp}
                </p>
              ) : null}
            </form>
          ) : (
            <>
              <div className="login-tabs">
                {(
                  [
                    { id: "login" as Tab, label: "Connexion" },
                    { id: "register" as Tab, label: "Inscription" },
                  ] as const
                ).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      setTab(t.id);
                      setErrors({});
                    }}
                    style={{
                      fontWeight: tab === t.id ? 600 : 400,
                      color: tab === t.id ? "var(--lj-tab-active)" : "var(--lj-muted)",
                    }}
                  >
                    {t.label}
                  </button>
                ))}
                <span
                  className="login-tabs-ink"
                  style={{ transform: tab === "register" ? "translateX(100%)" : "translateX(0)" }}
                />
              </div>

              {tab === "login" ? (
                <form onSubmit={handleLogin} className="login-form" noValidate>
                  <FloatingInput
                    id="login-id"
                    theme="joueur"
                    label="Téléphone ou email"
                    type={loginIsEmail ? "email" : "text"}
                    inputMode={loginInputMode}
                    autoComplete="username"
                    value={loginForm.identifier}
                    onChange={onLoginIdentifierChange}
                    erreur={errors.identifier}
                    iconeGauche={
                      loginIsEmail || loginHasLetter ? undefined : (
                        <span className="text-sm">+221</span>
                      )
                    }
                  />

                  <FloatingInput
                    id="login-pass"
                    theme="joueur"
                    label="Ton mot de passe"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    value={loginForm.password}
                    onChange={(v) => {
                      setLoginForm((f) => ({ ...f, password: v }));
                      setErrors((prev) => ({ ...prev, password: "" }));
                    }}
                    erreur={errors.password}
                    iconeDroite={showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    onIconeDroiteClick={() => setShowPassword(!showPassword)}
                  />

                  <button
                    type="button"
                    className="login-forgot"
                    onClick={() => setShowForgot(true)}
                  >
                    Mot de passe oublié ?
                  </button>

                  <BoutonSoumettre
                    theme="joueur"
                    label="Se connecter"
                    labelLoading="Connexion en cours..."
                    loading={submitting}
                    onClick={() => {}}
                  />
                  {errors.form ? (
                    <p
                      className="flex items-center gap-2 text-[13px] animate-[login-fade-in_0.2s_ease]"
                      style={{ color: "var(--lj-error)" }}
                    >
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      {errors.form}
                    </p>
                  ) : null}
                </form>
              ) : (
                <form onSubmit={handleRegister} className="login-form" noValidate>
                  <FloatingInput
                    id="prenom"
                    theme="joueur"
                    label="Prénom"
                    autoComplete="given-name"
                    value={registerForm.prenom}
                    onChange={(v) => {
                      setRegisterForm((f) => ({ ...f, prenom: v }));
                      setErrors((prev) => ({ ...prev, prenom: "" }));
                    }}
                    erreur={errors.prenom}
                  />
                  <FloatingInput
                    id="nom"
                    theme="joueur"
                    label="Nom"
                    autoComplete="family-name"
                    value={registerForm.nom}
                    onChange={(v) => {
                      setRegisterForm((f) => ({ ...f, nom: v }));
                      setErrors((prev) => ({ ...prev, nom: "" }));
                    }}
                    erreur={errors.nom}
                  />
                  <FloatingInput
                    id="reg-phone"
                    theme="joueur"
                    label="Ton numéro de téléphone"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    value={registerForm.telephone}
                    onChange={(v) =>
                      onPhoneChange(v, (next) => setRegisterForm((f) => ({ ...f, telephone: next })), "telephone")
                    }
                    erreur={errors.telephone}
                    succes={phoneValid}
                    iconeGauche={<span className="text-sm">+221</span>}
                  />
                  <div>
                    <FloatingInput
                      id="reg-pass"
                      theme="joueur"
                      label="Ton mot de passe"
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      value={registerForm.password}
                      onChange={(v) => {
                        setRegisterForm((f) => ({ ...f, password: v }));
                        setErrors((prev) => ({ ...prev, password: "" }));
                      }}
                      erreur={errors.password}
                      iconeDroite={showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      onIconeDroiteClick={() => setShowPassword(!showPassword)}
                    />
                    <IndicateurForceMdp password={registerForm.password} theme="joueur" />
                  </div>
                  <FloatingInput
                    id="reg-confirm"
                    theme="joueur"
                    label="Confirmer le mot de passe"
                    type={showConfirm ? "text" : "password"}
                    autoComplete="new-password"
                    value={registerForm.confirm}
                    onChange={(v) => {
                      setRegisterForm((f) => ({ ...f, confirm: v }));
                      setErrors((prev) => ({ ...prev, confirm: "" }));
                    }}
                    erreur={errors.confirm}
                    succes={passwordsMatch}
                    iconeDroite={
                      passwordsMatch ? <Check className="w-4 h-4" /> : showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />
                    }
                    onIconeDroiteClick={passwordsMatch ? undefined : () => setShowConfirm(!showConfirm)}
                  />

                  <BoutonSoumettre
                    theme="joueur"
                    label="S'inscrire"
                    labelLoading="Création du compte..."
                    loading={submitting}
                    onClick={() => {}}
                  />
                  {errors.form ? (
                    <p
                      className="flex items-center gap-2 text-[13px] animate-[login-fade-in_0.2s_ease]"
                      style={{ color: "var(--lj-error)" }}
                    >
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      {errors.form}
                    </p>
                  ) : null}
                </form>
              )}
            </>
          )}
      </div>

      <MotDePasseOublie
        open={showForgot}
        onOpenChange={setShowForgot}
        theme="joueur"
        telephoneInitial={loginForm.identifier.includes("@") ? "" : loginForm.identifier}
        onSucces={() => {
          window.setTimeout(() => document.getElementById("login-pass")?.focus(), 50);
        }}
      />
    </div>
  );
}
