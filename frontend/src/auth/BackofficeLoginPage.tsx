import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AlertCircle, Eye, EyeOff, Mail, Phone } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { homeForUser, normalizeRole } from "@/auth/roles";
import { formatPhoneDisplay, phoneError, toLocal9 } from "@/auth/phone";
import { messageErreurAuth } from "@/auth/loginErrors";
import FloatingInput from "@/components/FloatingInput";
import BoutonSoumettre from "@/components/BoutonSoumettre";
import MotDePasseOublie from "@/components/MotDePasseOublie";
import LoginHeroVideo from "@/components/LoginHeroVideo";

const API_URL = import.meta.env.VITE_API_URL || "/api";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RATE_LIMIT_MSG = "Trop de tentatives. Réessayez dans quelques minutes.";

const ROLE_LABEL: Record<string, string> = {
  super_admin: "Super admin",
  proprietaire: "Propriétaire",
  gerant: "Gérant",
};

function identifierError(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "Téléphone ou email requis";
  if (trimmed.includes("@")) {
    if (!EMAIL_RE.test(trimmed)) return "Adresse email invalide";
    return null;
  }
  return phoneError(trimmed);
}

/**
 * /backoffice/login — espace administration uniquement.
 * Ne redirige plus automatiquement si une session staff existe :
 * on peut rester sur le formulaire pour se connecter en propriétaire / gérant.
 */
export default function BackofficeLoginPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { setSession, logout, isAuthenticated, user, loading } = useAuth();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [showForgot, setShowForgot] = useState(false);
  /** Affiche le formulaire même si une session staff est encore active. */
  const [forceLoginForm, setForceLoginForm] = useState(
    () => searchParams.get("switch") === "1",
  );

  const staffRole =
    !loading && isAuthenticated && user ? normalizeRole(user) : null;
  const isStaffSession = !!staffRole && staffRole !== "joueur";
  const showExistingSession = isStaffSession && !forceLoginForm;

  useEffect(() => {
    if (loading) return;
    if (searchParams.get("switch") === "1") {
      logout();
      setForceLoginForm(true);
      setSearchParams({}, { replace: true });
      return;
    }
    if (isAuthenticated && user && normalizeRole(user) === "joueur") {
      logout();
    }
  }, [loading, isAuthenticated, user, logout, searchParams, setSearchParams]);

  const switchAccount = () => {
    logout();
    setForceLoginForm(true);
    setIdentifier("");
    setPassword("");
    setError("");
    setFieldErrors({});
  };

  const onIdentifierChange = (raw: string) => {
    if (raw.includes("@")) {
      setIdentifier(raw);
    } else {
      const hasLetter = /[a-zA-Z]/.test(raw);
      setIdentifier(hasLetter ? raw : formatPhoneDisplay(raw));
    }
    setFieldErrors((f) => ({ ...f, identifier: "" }));
    setError("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    const idErr = identifierError(identifier);
    if (idErr) next.identifier = idErr;
    if (!password) next.password = "Mot de passe requis";
    setFieldErrors(next);
    setError("");
    if (Object.keys(next).length) return;

    setSubmitting(true);
    try {
      const trimmed = identifier.trim();
      const isEmail = trimmed.includes("@");
      const body = isEmail
        ? { email: trimmed.toLowerCase(), password }
        : { telephone: toLocal9(trimmed), password };

      let res: Response;
      try {
        res = await fetch(`${API_URL}/backoffice/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } catch {
        throw new Error("Connexion au serveur impossible. Vérifiez votre connexion.");
      }
      const data = await res.json().catch(() => ({} as { error?: string; user?: unknown; token?: string }));
      if (!res.ok) {
        const raw = typeof data.error === "string" ? data.error : "";
        if (res.status === 429 || /trop de tentatives/i.test(raw)) {
          throw Object.assign(new Error(RATE_LIMIT_MSG), { status: 429 });
        }
        throw Object.assign(new Error(raw || "Identifiants incorrects"), { status: res.status });
      }

      const connected = data.user;
      const token = data.token || data.accessToken;
      const role = normalizeRole(connected);
      if (!role || role === "joueur") {
        await logout({ redirect: false });
        setError("Accès non autorisé pour ce rôle.");
        return;
      }

      localStorage.setItem("terrainsn_token", token);
      localStorage.setItem("access_token", token);
      localStorage.setItem("terrainsn_user", JSON.stringify(connected));
      setSession(connected, token);
      setForceLoginForm(false);

      if (connected?.must_change_password) {
        navigate("/changer-mot-de-passe", { replace: true });
        return;
      }
      toast.success("Connexion réussie");
      navigate(homeForUser(connected), { replace: true });
    } catch (err: any) {
      const msg = String(err?.message || "");
      const message = /trop de tentatives/i.test(msg)
        ? RATE_LIMIT_MSG
        : messageErreurAuth(err, "backoffice");
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const roleLabel =
    staffRole && ROLE_LABEL[staffRole] ? ROLE_LABEL[staffRole] : "Administration";

  const trimmedId = identifier.trim();
  const looksEmail = trimmedId.includes("@");
  const looksPhone = !!trimmedId && !looksEmail && !/[a-zA-Z]/.test(trimmedId);
  const idLiveError = trimmedId ? identifierError(identifier) : null;
  const idValid = !!trimmedId && !idLiveError;

  const brand = (
    <div className="px-6">
      <p className="text-[22px] font-black tracking-tight text-white">
        TERRAIN<span className="text-[var(--lb-primary)]">.SN</span>
      </p>
      <span
        className="inline-flex mt-2 px-3 py-1 rounded-full text-[11px] font-semibold backdrop-blur-md border"
        style={{
          background: "var(--lb-badge-bg)",
          color: "var(--lb-badge-text)",
          borderColor: "color-mix(in srgb, var(--lb-primary) 30%, transparent)",
        }}
      >
        Espace administration
      </span>
    </div>
  );

  const formInner = showExistingSession ? (
    <>
      <h2
        className="text-[20px] font-bold mb-2 text-center"
        style={{ fontFamily: "var(--font-display)", color: "var(--lb-text)" }}
      >
        Session active
      </h2>
      <p className="text-[13px] text-center mb-6" style={{ color: "var(--lb-muted)" }}>
        Vous êtes déjà connecté en tant que{" "}
        <span className="font-medium" style={{ color: "var(--lb-text)" }}>{roleLabel}</span>
        {user?.email ? ` (${user.email})` : user?.telephone ? ` (${user.telephone})` : ""}.
        Choisissez de continuer ou de vous connecter avec un autre compte (propriétaire, gérant…).
      </p>
      <div className="flex flex-col gap-3">
        <BoutonSoumettre
          theme="backoffice"
          type="button"
          label="Continuer vers mon espace"
          labelLoading="Redirection..."
          loading={false}
          onClick={() => navigate(homeForUser(user), { replace: true })}
        />
        <button
          type="button"
          onClick={switchAccount}
          className="w-full h-[52px] rounded-[14px] text-sm font-medium min-h-[44px] border"
          style={{
            borderColor: "var(--lb-border)",
            color: "var(--lb-text)",
            background: "var(--lb-sheet-bg)",
          }}
        >
          Se connecter avec un autre compte
        </button>
      </div>
    </>
  ) : (
    <>
      <h2
        className="text-[20px] font-bold"
        style={{ fontFamily: "var(--font-display)", color: "var(--lb-text)" }}
      >
        Connexion
      </h2>
      <p className="text-[13px] mb-6" style={{ color: "var(--lb-muted)" }}>
        Gérant · Propriétaire
      </p>

      <form onSubmit={handleSubmit} className="login-form" noValidate>
        <FloatingInput
          id="bo-id"
          theme="backoffice"
          label="Téléphone ou email"
          type={looksEmail ? "email" : "text"}
          inputMode={looksEmail ? "email" : "tel"}
          autoComplete="username"
          value={identifier}
          onChange={onIdentifierChange}
          erreur={fieldErrors.identifier || ((looksEmail || looksPhone) && idLiveError ? idLiveError : undefined)}
          succes={idValid && (looksEmail || looksPhone)}
          iconeDroite={
            looksPhone ? <Phone className="w-4 h-4" /> : looksEmail ? <Mail className="w-4 h-4" /> : undefined
          }
        />

        <FloatingInput
          id="bo-pass"
          theme="backoffice"
          label="Mot de passe"
          type={showPassword ? "text" : "password"}
          autoComplete="current-password"
          value={password}
          onChange={(v) => {
            setPassword(v);
            setFieldErrors((f) => ({ ...f, password: "" }));
            setError("");
          }}
          erreur={fieldErrors.password}
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
          theme="backoffice"
          label="Se connecter"
          labelLoading="Connexion en cours..."
          loading={submitting}
          onClick={() => {}}
        />
        {error ? (
          <p
            className="flex items-center gap-2 text-[13px] animate-[login-fade-in_0.2s_ease]"
            style={{ color: "var(--lb-error)" }}
          >
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </p>
        ) : null}
      </form>

      <p className="text-center text-[12px] mt-6 leading-relaxed" style={{ color: "var(--lb-muted)" }}>
        Ton accès est créé par l&apos;administration.
        <br />
        Pour toute question :{" "}
        <a href="mailto:support@terrainsn.sn" className="underline underline-offset-2">
          support@terrainsn.sn
        </a>
      </p>
    </>
  );

  return (
    <div className="login-backoffice">
      <div className="login-media">
        <LoginHeroVideo />
        <div className="login-bg-overlay" aria-hidden />
        <div className="login-brand">{brand}</div>
      </div>

      <div className="login-sheet">
        {formInner}
      </div>
      <MotDePasseOublie
        open={showForgot}
        onOpenChange={setShowForgot}
        theme="backoffice"
        telephoneInitial={identifier.includes("@") ? "" : identifier}
        onSucces={() => {
          window.setTimeout(() => document.getElementById("bo-pass")?.focus(), 50);
        }}
      />
    </div>
  );
}
