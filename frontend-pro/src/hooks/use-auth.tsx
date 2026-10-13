import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { authApi } from "@/lib/api";
import SkeletonSession from "@/components/skeletons/SkeletonSession";
import {
  checkMissedNotificationsForUser,
  resetMissedNotificationsState,
} from "@/lib/missedNotifications";
import { normalizeRole, type AppRole } from "@/auth/roles";

/** Rôles autorisés sur l'app pro (pro.terrainsn.com). */
export const ROLES_AUTORISES: AppRole[] = ["gerant", "proprietaire", "super_admin"];
export const MSG_ACCES_PRO = "Accès réservé aux professionnels TerrainSN.";

function isRoleAutorise(u: { role?: string; accountType?: string } | null | undefined): boolean {
  const role = normalizeRole(u);
  return !!role && ROLES_AUTORISES.includes(role);
}

interface User {
  id: number;
  nom: string;
  prenom?: string;
  email?: string;
  telephone?: string;
  role: string;
  accountType?: string;
  [key: string]: any;
}

interface AuthContextType {
  user: User | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  loading: boolean;
  /** Message affiché quand une session non-pro (ex. joueur) a été refusée. */
  accessError: string | null;
  clearAccessError: () => void;
  login: (identifier: string, password: string) => Promise<User>;
  setSession: (user: User, token?: string) => void;
  register: (data: { nom: string; email: string; password: string; telephone: string }) => Promise<void>;
  logout: (options?: { redirect?: boolean }) => Promise<void>;
  refreshUser: () => Promise<void>;
  rafraichirToken: () => Promise<string | null>;
  requeteAvecAuth: (url: string, options?: RequestInit) => Promise<Response>;
}

const AuthContext = createContext<AuthContextType | null>(null);

function parseJwt(token: string): User | null {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return payload as User;
  } catch {
    return null;
  }
}

function readStoredAccessToken(): string | null {
  return (
    localStorage.getItem("tsn_pro_token")
    || localStorage.getItem("access_token")
    || localStorage.getItem("terrainsn_token")
  );
}

function loginHref(): string {
  const base = String(import.meta.env.BASE_URL || "/");
  const path = `${base}login`.replace(/\/{2,}/g, "/");
  return path.startsWith("http") ? path : path;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(authApi.getUser());
  const [accessToken, setAccessToken] = useState<string | null>(readStoredAccessToken());
  const [loading, setLoading] = useState(true);
  const [booting, setBooting] = useState(true);
  const [accessError, setAccessError] = useState<string | null>(null);

  /** Purge locale uniquement — ne pas invalider la session joueur (même API). */
  function clearLocalSession() {
    localStorage.removeItem("tsn_pro_token");
    localStorage.removeItem("tsn_pro_user");
    localStorage.removeItem("access_token");
    localStorage.removeItem("terrainsn_token");
    localStorage.removeItem("terrainsn_user");
    setUser(null);
    setAccessToken(null);
  }

  /** Refuse une session non-pro : purge locale et mémorise le message (pas de logout serveur). */
  async function refuserAccesNonPro(): Promise<void> {
    setAccessError(MSG_ACCES_PRO);
    clearLocalSession();
  }

  async function rafraichirToken(): Promise<string | null> {
    try {
      const newToken = await authApi.refresh();
      if (!newToken) {
        clearLocalSession();
        return null;
      }
      const payload = parseJwt(newToken);
      if (payload && payload.role && !isRoleAutorise(payload)) {
        await refuserAccesNonPro();
        return null;
      }
      setAccessToken(newToken);
      if (payload) setUser((prev) => ({ ...(prev || {}), ...payload, ...(authApi.getUser() || {}) } as User));
      try {
        const me = await authApi.me();
        if (!isRoleAutorise(me)) {
          await refuserAccesNonPro();
          return null;
        }
        setUser(me);
      } catch {
        // token ok mais /me indisponible — garder le payload
      }
      return newToken;
    } catch {
      const tokenStocke = readStoredAccessToken();
      if (tokenStocke) {
        const payload = parseJwt(tokenStocke);
        const maintenant = Date.now() / 1000;
        if (payload && typeof (payload as any).exp === "number" && (payload as any).exp > maintenant) {
          return tokenStocke;
        }
      }
      clearLocalSession();
      return null;
    }
  }

  async function restaurerSession() {
    const tokenStocke = readStoredAccessToken();
    if (!tokenStocke) {
      try {
        const refreshed = await rafraichirToken();
        if (!refreshed) setUser(null);
      } catch {
        setUser(null);
      }
      return;
    }

    const payload = parseJwt(tokenStocke);
    if (payload && !isRoleAutorise(payload)) {
      await refuserAccesNonPro();
      return;
    }
    const maintenant = Date.now() / 1000;
    if (payload && typeof (payload as any).exp === "number" && (payload as any).exp > maintenant) {
      setAccessToken(tokenStocke);
      try {
        const me = await authApi.me();
        if (!isRoleAutorise(me)) {
          await refuserAccesNonPro();
          return;
        }
        setUser(me);
      } catch {
        if (payload) setUser((prev) => ({ ...(prev || {}), ...payload } as User));
        else await rafraichirToken();
      }
    } else {
      await rafraichirToken();
    }
  }

  async function requeteAvecAuth(url: string, options: RequestInit = {}): Promise<Response> {
    const token = readStoredAccessToken() || accessToken;
    let res = await fetch(url, {
      ...options,
      headers: {
        ...(options.headers || {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      credentials: "include",
    });

    if (res.status === 401) {
      let data: { error?: string } = {};
      try {
        data = await res.clone().json();
      } catch {
        data = {};
      }
      if (data.error === "TOKEN_EXPIRE") {
        const next = await rafraichirToken();
        if (next) {
          res = await fetch(url, {
            ...options,
            headers: {
              ...(options.headers || {}),
              Authorization: `Bearer ${next}`,
            },
            credentials: "include",
          });
        }
      }
    }
    return res;
  }

  async function deconnecter(redirect = true) {
    try {
      await authApi.logout();
    } catch {
      // ignore
    }
    clearLocalSession();
    if (redirect && typeof window !== "undefined") {
      window.location.href = loginHref();
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await restaurerSession();
      } finally {
        if (!cancelled) {
          setLoading(false);
          setBooting(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Notifications manquées (push non vus / sans abonnement) → toasts à la connexion ou restauration de session
  const missedKey = user?.id != null ? `${user.accountType || "user"}:${user.id}` : "";
  useEffect(() => {
    if (!missedKey || booting) {
      if (!missedKey) resetMissedNotificationsState();
      return;
    }
    checkMissedNotificationsForUser(missedKey);
    const onVisible = () => {
      if (document.visibilityState === "visible") checkMissedNotificationsForUser(missedKey, { force: true });
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [missedKey, booting]);

  const setSession = (nextUser: User, token?: string) => {
    if (!isRoleAutorise(nextUser)) {
      void refuserAccesNonPro();
      return;
    }
    setAccessError(null);
    setUser(nextUser);
    if (token) {
      localStorage.setItem("tsn_pro_token", token);
      setAccessToken(token);
    } else {
      setAccessToken(readStoredAccessToken());
    }
  };

  const login = async (identifier: string, password: string) => {
    setLoading(true);
    try {
      // Note: l'UI pro utilise BackofficeLoginPage → /backoffice/auth/login via setSession.
      // smartLogin reste un fallback et échouera pour les comptes pro (route joueur).
      const result = await authApi.smartLogin(identifier, password);
      if (!isRoleAutorise(result.user)) {
        await refuserAccesNonPro();
        throw new Error(MSG_ACCES_PRO);
      }
      const token = result.accessToken || result.token || readStoredAccessToken();
      setAccessError(null);
      setUser(result.user);
      if (token) {
        localStorage.setItem("tsn_pro_token", token);
        setAccessToken(token);
      }
      return result.user as User;
    } catch (err: any) {
      const error = new Error(err.message || "Identifiants incorrects") as Error & {
        code?: string;
        telephone?: string;
      };
      if (err.code) error.code = err.code;
      else if (/OTP_REQUIRED|non vérifié/i.test(err.message || "")) error.code = "OTP_REQUIRED";
      if (err.telephone) error.telephone = err.telephone;
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const register = async (data: { nom: string; email: string; password: string; telephone: string }) => {
    setLoading(true);
    try {
      const result = await authApi.register(data);
      if (result.user) setUser(result.user);
      const token = result.accessToken || result.token || readStoredAccessToken();
      if (token) setAccessToken(token);
    } finally {
      setLoading(false);
    }
  };

  const refreshUser = async () => {
    if (!authApi.isAuthenticated()) {
      setUser(null);
      return;
    }
    try {
      const data = await authApi.me();
      if (!isRoleAutorise(data)) {
        await refuserAccesNonPro();
        return;
      }
      setUser(data);
      return data;
    } catch {
      setUser(null);
      await deconnecter(false);
    }
  };

  const logout = async (options?: { redirect?: boolean }) => {
    await deconnecter(options?.redirect !== false);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        accessToken,
        isAuthenticated: !!user,
        loading,
        accessError,
        clearAccessError: () => setAccessError(null),
        login,
        setSession,
        register,
        logout,
        refreshUser,
        rafraichirToken,
        requeteAvecAuth,
      }}
    >
      {booting ? <SkeletonSession /> : children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth doit être utilisé dans un AuthProvider");
  return ctx;
}
