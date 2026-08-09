import { useRef, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { Eye, EyeOff, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { authApi } from "@/lib/api";
import { homeForUser, normalizeRole } from "@/auth/roles";
import { formatPhoneDisplay, isValidSenegalMobile, phoneError, toLocal9 } from "@/auth/phone";
import ForgotPasswordModal from "@/auth/ForgotPasswordModal";
import { fieldImageForId } from "@/espaces/joueur/components/FieldPhoto";

type Tab = "login" | "register";
type Step = "form" | "otp";

function FieldError({ message }: { message?: string | null }) {
  if (!message) return null;
  return <p className="mt-1.5 text-xs text-[var(--color-danger)]">{message}</p>;
}

const RATE_LIMIT_MSG = "Trop de tentatives. Réessayez dans quelques minutes.";

function clientAuthError(err: unknown, fallback: string): string {
  const e = err as { status?: number; message?: string };
  const msg = String(e?.message || "");
  if (e?.status === 429 || /trop de tentatives/i.test(msg)) return RATE_LIMIT_MSG;
  if (/syntaxerror|sql\b|stack|paytech|whatsapp|<html|exception/i.test(msg)) return fallback;
  return msg || fallback;
}

function FloatingField({
  id,
  label,
  focused,
  filled,
  children,
  prefix,
}: {
  id: string;
  label: string;
  focused: boolean;
  filled: boolean;
  children: React.ReactNode;
  prefix?: React.ReactNode;
}) {
  const floated = focused || filled;
  return (
    <div
      className={`relative flex items-center gap-2 rounded-[var(--radius-md)] border bg-white px-4 min-h-[56px] transition-colors ${
        focused ? "border-[var(--color-primary)]" : "border-[var(--color-border)]"
      }`}
    >
      <label
        htmlFor={id}
        className={`absolute transition-all pointer-events-none z-[1] ${
          prefix ? "left-16" : "left-4"
        } ${
          floated
            ? "top-1.5 text-[11px] text-[var(--color-primary)]"
            : "top-1/2 -translate-y-1/2 text-sm text-[var(--color-text-muted)]"
        }`}
      >
        {label}
      </label>
      {prefix && (
        <div className="flex items-center shrink-0 self-end pb-3.5 text-[var(--color-text-muted)]">
          {prefix}
        </div>
      )}
      <div className="flex-1 flex items-center gap-1 self-end pb-2.5 min-w-0">{children}</div>
    </div>
  );
}

/**
 * /login — espace joueur uniquement.
 * Onglets Connexion / Inscription + vérification OTP WhatsApp.
 */
export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, setSession, isAuthenticated, user, loading, logout } = useAuth();

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
  const [focus, setFocus] = useState<string | null>(null);

  const [loginForm, setLoginForm] = useState({ telephone: "", password: "" });
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
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);

  if (!loading && isAuthenticated && user) {
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

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const nextErrors: Record<string, string> = {};
    const phoneErr = phoneError(loginForm.telephone);
    if (phoneErr) nextErrors.telephone = phoneErr;
    if (!loginForm.password) nextErrors.password = "Mot de passe requis";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    setSubmitting(true);
    try {
      const connected = await login(toLocal9(loginForm.telephone), loginForm.password);
      const role = normalizeRole(connected);
      if (role !== "joueur") {
        logout();
        toast.error("Cet espace est réservé aux joueurs.");
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
        setOtpPhone(formatPhoneDisplay(loginForm.telephone));
        setStep("otp");
        toast.message("Validez le code reçu sur WhatsApp");
        return;
      }
      const message = clientAuthError(err, "Identifiants incorrects");
      setErrors({ form: message });
      toast.error(message);
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
      setTimeout(() => otpRefs.current[0]?.focus(), 50);
    } catch (err: any) {
      const message = clientAuthError(err, "Inscription impossible");
      setErrors({ form: message });
      toast.error(message);
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
      const message = clientAuthError(err, "Code invalide");
      setErrors({ otp: message });
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleResend = async () => {
    setResending(true);
    try {
      await authApi.resendOtp(toLocal9(otpPhone));
      toast.success("Nouveau code envoyé");
    } catch (err: any) {
      toast.error(clientAuthError(err, "Impossible de renvoyer le code"));
    } finally {
      setResending(false);
    }
  };

  const setOtpDigit = (index: number, raw: string) => {
    const digit = raw.replace(/\D/g, "").slice(-1);
    const arr = Array.from({ length: 6 }, (_, i) => otpCode[i] || "");
    arr[index] = digit;
    const code = arr.join("");
    setOtpCode(code);
    setErrors((prev) => ({ ...prev, otp: "" }));
    if (digit && index < 5) otpRefs.current[index + 1]?.focus();
  };

  const onOtpKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !otpCode[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  };

  const onOtpPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (!pasted) return;
    setOtpCode(pasted);
    setErrors((prev) => ({ ...prev, otp: "" }));
    const focusAt = Math.min(pasted.length, 5);
    otpRefs.current[focusAt]?.focus();
  };

  const inputClass =
    "w-full bg-transparent outline-none text-sm text-[var(--color-text-primary)] placeholder:transparent";

  return (
    <div className="min-h-screen relative flex flex-col justify-end sm:justify-center sm:items-center sm:px-4">
      <img
        src={fieldImageForId(2)}
        alt=""
        className="absolute inset-0 w-full h-full object-cover"
        style={{ filter: "brightness(0.35)" }}
        aria-hidden
      />
      <div className="absolute inset-0 bg-[var(--color-primary-dark)]/80" aria-hidden />
      <div className="relative z-[1] w-full max-w-[420px] bg-white rounded-t-[var(--radius-xl)] sm:rounded-[var(--radius-xl)] px-5 pt-8 pb-10 min-h-[65dvh] sm:min-h-0 shadow-[var(--shadow-lg)]">
        <div className="text-center mb-8">
          <Link
            to="/"
            className="inline-flex items-center justify-center w-16 h-16 rounded-[var(--radius-lg)] bg-[var(--color-primary)] text-white text-2xl font-semibold mb-4 shadow-sm"
            style={{ fontFamily: "var(--font-display)" }}
          >
            TS
          </Link>
          <h1
            className="text-xl font-bold text-[var(--color-text-primary)] tracking-tight"
            style={{ fontFamily: "var(--font-display)" }}
          >
            TerrainSN
          </h1>
          <p className="text-sm text-[var(--color-text-secondary)] mt-2">
            {step === "otp" ? "Vérification WhatsApp" : "Réserve ton terrain en quelques minutes"}
          </p>
        </div>

        {step === "otp" ? (
          <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] p-6 sm:p-8">
            <button
              type="button"
              onClick={() => {
                setStep("form");
                setOtpCode("");
                setErrors({});
              }}
              className="inline-flex items-center gap-1.5 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] mb-5 min-h-[44px]"
            >
              <ArrowLeft className="w-4 h-4" /> Retour
            </button>

            <p className="text-sm text-[var(--color-text-secondary)] mb-6 leading-relaxed">
              Un code à 6 chiffres a été envoyé au{" "}
              <span className="font-medium text-[var(--color-text-primary)]">{otpPhone}</span> via
              WhatsApp.
            </p>

            <form onSubmit={handleVerifyOtp} className="flex flex-col gap-5">
              <div>
                <div className="flex justify-between gap-2" onPaste={onOtpPaste}>
                  {Array.from({ length: 6 }).map((_, i) => (
                    <input
                      key={i}
                      ref={(el) => {
                        otpRefs.current[i] = el;
                      }}
                      inputMode="numeric"
                      autoComplete={i === 0 ? "one-time-code" : "off"}
                      maxLength={1}
                      value={otpCode[i] || ""}
                      onChange={(e) => setOtpDigit(i, e.target.value)}
                      onKeyDown={(e) => onOtpKeyDown(i, e)}
                      className="w-11 h-14 sm:w-12 sm:h-14 text-center text-lg font-semibold rounded-[var(--radius-md)] border border-[var(--color-border)] bg-white text-[var(--color-text-primary)] outline-none focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--color-primary)_20%,transparent)]"
                      style={{ fontFamily: "var(--font-display)" }}
                      aria-label={`Chiffre ${i + 1}`}
                    />
                  ))}
                </div>
                <FieldError message={errors.otp} />
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full h-[52px] rounded-[var(--radius-md)] bg-[var(--color-primary)] text-white text-sm font-medium hover:bg-[var(--color-primary-light)] disabled:bg-[var(--color-text-muted)] disabled:cursor-not-allowed"
              >
                {submitting ? "Vérification..." : "Vérifier"}
              </button>

              <button
                type="button"
                disabled={resending}
                onClick={handleResend}
                className="text-sm text-[var(--color-primary)] font-medium hover:underline disabled:opacity-50 min-h-[44px]"
              >
                {resending ? "Envoi..." : "Renvoyer le code"}
              </button>
            </form>
          </div>
        ) : (
          <>
            <div className="relative flex border-b border-[var(--color-border)] mb-6">
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
                  className={`flex-1 pb-3 text-sm font-medium transition-colors relative min-h-[48px] ${
                    tab === t.id
                      ? "text-[var(--color-primary)]"
                      : "text-[var(--color-text-secondary)]"
                  }`}
                >
                  {t.label}
                  <span
                    className={`absolute left-2 right-2 bottom-0 h-0.5 rounded-full bg-[var(--color-primary)] transition-transform origin-center duration-200 ${
                      tab === t.id ? "scale-x-100" : "scale-x-0"
                    }`}
                  />
                </button>
              ))}
            </div>

            {errors.form && (
              <div className="mb-4 rounded-[var(--radius-md)] bg-red-50 px-4 py-3 text-sm text-[var(--color-danger)]">
                {errors.form}
              </div>
            )}

            {tab === "login" ? (
              <form onSubmit={handleLogin} className="flex flex-col gap-4" noValidate>
                <div>
                  <FloatingField
                    id="login-phone"
                    label="Numéro de téléphone"
                    focused={focus === "login-phone"}
                    filled={!!loginForm.telephone}
                    prefix={<span className="text-sm text-[var(--color-text-muted)]">+221</span>}
                  >
                    <input
                      id="login-phone"
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      value={loginForm.telephone}
                      onFocus={() => setFocus("login-phone")}
                      onBlur={() => setFocus(null)}
                      onChange={(e) =>
                        onPhoneChange(
                          e.target.value,
                          (v) => setLoginForm((f) => ({ ...f, telephone: v })),
                          "telephone"
                        )
                      }
                      className={inputClass}
                    />
                  </FloatingField>
                  <FieldError message={errors.telephone} />
                </div>

                <div>
                  <FloatingField
                    id="login-pass"
                    label="Mot de passe"
                    focused={focus === "login-pass"}
                    filled={!!loginForm.password}
                  >
                    <input
                      id="login-pass"
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      value={loginForm.password}
                      onFocus={() => setFocus("login-pass")}
                      onBlur={() => setFocus(null)}
                      onChange={(e) => {
                        setLoginForm((f) => ({ ...f, password: e.target.value }));
                        setErrors((prev) => ({ ...prev, password: "" }));
                      }}
                      className={inputClass}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="text-[var(--color-text-muted)] p-1"
                      aria-label={showPassword ? "Masquer" : "Afficher"}
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </FloatingField>
                  <FieldError message={errors.password} />
                </div>

                <button
                  type="button"
                  className="text-xs text-[var(--color-primary)] font-medium text-right hover:underline min-h-[40px]"
                  onClick={() => setShowForgot(true)}
                >
                  Mot de passe oublié ?
                </button>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full h-[52px] rounded-[var(--radius-md)] bg-[var(--color-primary)] text-white text-sm font-medium hover:bg-[var(--color-primary-light)] disabled:bg-[var(--color-text-muted)] disabled:cursor-not-allowed"
                >
                  {submitting ? "Connexion..." : "Se connecter"}
                </button>

                <p className="text-center text-sm text-[var(--color-text-secondary)]">
                  Pas encore de compte ?{" "}
                  <button
                    type="button"
                    onClick={() => {
                      setTab("register");
                      setErrors({});
                    }}
                    className="text-[var(--color-primary)] font-medium hover:underline"
                  >
                    S&apos;inscrire
                  </button>
                </p>
              </form>
            ) : (
              <form onSubmit={handleRegister} className="flex flex-col gap-4" noValidate>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <FloatingField
                      id="prenom"
                      label="Prénom"
                      focused={focus === "prenom"}
                      filled={!!registerForm.prenom}
                    >
                      <input
                        id="prenom"
                        autoComplete="given-name"
                        value={registerForm.prenom}
                        onFocus={() => setFocus("prenom")}
                        onBlur={() => setFocus(null)}
                        onChange={(e) => {
                          setRegisterForm((f) => ({ ...f, prenom: e.target.value }));
                          setErrors((prev) => ({ ...prev, prenom: "" }));
                        }}
                        className={inputClass}
                      />
                    </FloatingField>
                    <FieldError message={errors.prenom} />
                  </div>
                  <div>
                    <FloatingField
                      id="nom"
                      label="Nom"
                      focused={focus === "nom"}
                      filled={!!registerForm.nom}
                    >
                      <input
                        id="nom"
                        autoComplete="family-name"
                        value={registerForm.nom}
                        onFocus={() => setFocus("nom")}
                        onBlur={() => setFocus(null)}
                        onChange={(e) => {
                          setRegisterForm((f) => ({ ...f, nom: e.target.value }));
                          setErrors((prev) => ({ ...prev, nom: "" }));
                        }}
                        className={inputClass}
                      />
                    </FloatingField>
                    <FieldError message={errors.nom} />
                  </div>
                </div>

                <div>
                  <FloatingField
                    id="reg-phone"
                    label="Numéro de téléphone"
                    focused={focus === "reg-phone"}
                    filled={!!registerForm.telephone}
                    prefix={<span className="text-sm text-[var(--color-text-muted)]">+221</span>}
                  >
                    <input
                      id="reg-phone"
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      value={registerForm.telephone}
                      onFocus={() => setFocus("reg-phone")}
                      onBlur={() => setFocus(null)}
                      onChange={(e) =>
                        onPhoneChange(
                          e.target.value,
                          (v) => setRegisterForm((f) => ({ ...f, telephone: v })),
                          "telephone"
                        )
                      }
                      className={inputClass}
                    />
                  </FloatingField>
                  <FieldError message={errors.telephone} />
                  {registerForm.telephone && isValidSenegalMobile(registerForm.telephone) && (
                    <p className="mt-1 text-[11px] text-[var(--color-primary)]">Format valide</p>
                  )}
                </div>

                <div>
                  <FloatingField
                    id="reg-pass"
                    label="Mot de passe"
                    focused={focus === "reg-pass"}
                    filled={!!registerForm.password}
                  >
                    <input
                      id="reg-pass"
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      value={registerForm.password}
                      onFocus={() => setFocus("reg-pass")}
                      onBlur={() => setFocus(null)}
                      onChange={(e) => {
                        setRegisterForm((f) => ({ ...f, password: e.target.value }));
                        setErrors((prev) => ({ ...prev, password: "" }));
                      }}
                      className={inputClass}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="text-[var(--color-text-muted)] p-1"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </FloatingField>
                  <FieldError message={errors.password} />
                </div>

                <div>
                  <FloatingField
                    id="reg-confirm"
                    label="Confirmer le mot de passe"
                    focused={focus === "reg-confirm"}
                    filled={!!registerForm.confirm}
                  >
                    <input
                      id="reg-confirm"
                      type={showConfirm ? "text" : "password"}
                      autoComplete="new-password"
                      value={registerForm.confirm}
                      onFocus={() => setFocus("reg-confirm")}
                      onBlur={() => setFocus(null)}
                      onChange={(e) => {
                        setRegisterForm((f) => ({ ...f, confirm: e.target.value }));
                        setErrors((prev) => ({ ...prev, confirm: "" }));
                      }}
                      className={inputClass}
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirm(!showConfirm)}
                      className="text-[var(--color-text-muted)] p-1"
                    >
                      {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </FloatingField>
                  <FieldError message={errors.confirm} />
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full h-[52px] rounded-[var(--radius-md)] bg-[var(--color-primary)] text-white text-sm font-medium hover:bg-[var(--color-primary-light)] disabled:bg-[var(--color-text-muted)] disabled:cursor-not-allowed mt-1"
                >
                  {submitting ? "Envoi du code..." : "S'inscrire"}
                </button>

                <p className="text-center text-sm text-[var(--color-text-secondary)]">
                  Déjà un compte ?{" "}
                  <button
                    type="button"
                    onClick={() => {
                      setTab("login");
                      setErrors({});
                    }}
                    className="text-[var(--color-primary)] font-medium hover:underline"
                  >
                    Se connecter
                  </button>
                </p>
              </form>
            )}
          </>
        )}
      </div>

      <ForgotPasswordModal open={showForgot} onOpenChange={setShowForgot} />
    </div>
  );
}
