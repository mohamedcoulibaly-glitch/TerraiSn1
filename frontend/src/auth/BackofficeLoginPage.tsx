import { useState, useEffect } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { homeForUser, normalizeRole } from "@/auth/roles";
import { formatPhoneDisplay, phoneError, toLocal9 } from "@/auth/phone";

const API_URL = import.meta.env.VITE_API_URL || "/api";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RATE_LIMIT_MSG = "Trop de tentatives. Réessayez dans quelques minutes.";

function identifierError(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "Téléphone ou email requis";
  if (trimmed.includes("@")) {
    if (!EMAIL_RE.test(trimmed)) return "Adresse email invalide";
    return null;
  }
  return phoneError(trimmed);
}

function FloatingField({
  id,
  label,
  focused,
  filled,
  children,
}: {
  id: string;
  label: string;
  focused: boolean;
  filled: boolean;
  children: React.ReactNode;
}) {
  const floated = focused || filled;
  return (
    <div
      className={`relative flex items-center gap-2 rounded-[var(--radius-md)] border bg-[var(--color-surface-2)] px-4 min-h-[56px] transition-colors duration-200 ${
        focused ? "border-[var(--color-primary)]" : "border-[var(--color-border)]"
      }`}
    >
      <label
        htmlFor={id}
        className={`absolute left-4 transition-all duration-200 pointer-events-none ${
          floated
            ? "top-1.5 text-[11px] text-[var(--color-primary)]"
            : "top-1/2 -translate-y-1/2 text-sm text-[var(--color-text-muted)]"
        }`}
      >
        {label}
      </label>
      <div className="flex-1 flex items-center gap-1 self-end pb-2.5 min-w-0">{children}</div>
    </div>
  );
}

/**
 * /backoffice/login — espace administration uniquement.
 */
export default function BackofficeLoginPage() {
  const navigate = useNavigate();
  const { setSession, logout, isAuthenticated, user, loading } = useAuth();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [focus, setFocus] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && isAuthenticated && user) {
      const role = normalizeRole(user);
      if (role === "joueur") {
        logout();
      }
    }
  }, [loading, isAuthenticated, user, logout]);

  if (!loading && isAuthenticated && user) {
    const role = normalizeRole(user);
    if (role && role !== "joueur") {
      return <Navigate to={homeForUser(user)} replace />;
    }
  }

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
          throw new Error(RATE_LIMIT_MSG);
        }
        throw new Error("Identifiants incorrects");
      }

      const connected = data.user;
      const role = normalizeRole(connected);
      if (!role || role === "joueur") {
        logout();
        setError("Accès non autorisé. Cet espace est réservé à l'administration.");
        return;
      }

      localStorage.setItem("terrainsn_token", data.token);
      localStorage.setItem("terrainsn_user", JSON.stringify(connected));
      setSession(connected, data.token);

      if (connected?.must_change_password) {
        navigate("/changer-mot-de-passe");
        return;
      }
      toast.success("Connexion réussie");
      navigate(homeForUser(connected), { replace: true });
    } catch (err: any) {
      const msg = String(err?.message || "");
      const message =
        /trop de tentatives/i.test(msg)
          ? RATE_LIMIT_MSG
          : msg || "Identifiants incorrects";
      setError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass =
    "w-full bg-transparent outline-none text-sm text-[var(--color-text-primary)]";

  return (
    <div className="min-h-screen bg-[var(--color-sidebar)] flex flex-col items-center justify-center px-6 py-10">
      <div className="text-center mb-8">
        <div
          className="inline-flex items-center justify-center w-14 h-14 rounded-[var(--radius-lg)] bg-[var(--color-primary)] text-white text-xl font-semibold mb-3"
          style={{ fontFamily: "var(--font-display)" }}
        >
          TS
        </div>
        <h1
          className="text-xl font-semibold text-white tracking-tight"
          style={{ fontFamily: "var(--font-display)" }}
        >
          TerrainSN
        </h1>
        <p className="text-sm text-white/45 mt-1.5">Espace administration</p>
      </div>

      <div className="w-full max-w-[420px] bg-white rounded-[var(--radius-lg)] p-6 sm:p-10 shadow-xl">
        <h2
          className="text-lg font-semibold text-[var(--color-text-primary)] mb-6 text-center"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Connexion
        </h2>

        {error && (
          <div className="mb-4 rounded-[var(--radius-md)] bg-red-50 px-4 py-3 text-sm text-[var(--color-danger)]">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
          <div>
            <FloatingField
              id="bo-id"
              label="Téléphone ou Email"
              focused={focus === "id"}
              filled={!!identifier}
            >
              <input
                id="bo-id"
                type="text"
                inputMode={identifier.includes("@") ? "email" : "tel"}
                autoComplete="username"
                value={identifier}
                onFocus={() => setFocus("id")}
                onBlur={() => setFocus(null)}
                onChange={(e) => onIdentifierChange(e.target.value)}
                className={inputClass}
              />
            </FloatingField>
            {fieldErrors.identifier && (
              <p className="mt-1.5 text-xs text-[var(--color-danger)]">{fieldErrors.identifier}</p>
            )}
          </div>

          <div>
            <FloatingField
              id="bo-pass"
              label="Mot de passe"
              focused={focus === "pass"}
              filled={!!password}
            >
              <input
                id="bo-pass"
                type={showPassword ? "text" : "password"}
                value={password}
                onFocus={() => setFocus("pass")}
                onBlur={() => setFocus(null)}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setFieldErrors((f) => ({ ...f, password: "" }));
                  setError("");
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
            {fieldErrors.password && (
              <p className="mt-1.5 text-xs text-[var(--color-danger)]">{fieldErrors.password}</p>
            )}
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full h-[52px] rounded-[var(--radius-md)] bg-[var(--color-primary)] text-white text-sm font-medium hover:bg-[var(--color-primary-light)] disabled:bg-[var(--color-text-muted)] disabled:cursor-not-allowed mt-2 inline-flex items-center justify-center gap-2"
          >
            {submitting ? (
              <>
                <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                Connexion...
              </>
            ) : (
              "Se connecter"
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
