import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { authApi } from "@/lib/api";
import SkeletonSession from "@/components/skeletons/SkeletonSession";

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
  login: (identifier: string, password: string) => Promise<User>;
  setSession: (user: User, token?: string) => void;
  register: (data: { nom: string; email: string; password: string; telephone: string }) => Promise<void>;
  logout: () => Promise<void>;
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
  return localStorage.getItem("access_token") || localStorage.getItem("terrainsn_token");
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(authApi.getUser());
  const [accessToken, setAccessToken] = useState<string | null>(readStoredAccessToken());
  const [loading, setLoading] = useState(true);
  const [booting, setBooting] = useState(true);

  async function rafraichirToken(): Promise<string | null> {
    try {
      const newToken = await authApi.refresh();
      if (!newToken) {
        await deconnecter(false);
        return null;
      }
      setAccessToken(newToken);
      const payload = parseJwt(newToken);
      if (payload) setUser((prev) => ({ ...(prev || {}), ...payload, ...(authApi.getUser() || {}) } as User));
      try {
        const me = await authApi.me();
        setUser(me);
      } catch {
        // token ok mais /me indisponible — garder le payload
      }
      return newToken;
    } catch {
      await deconnecter(false);
      return null;
    }
  }

  async function restaurerSession() {
    const tokenStocke = readStoredAccessToken();
    if (!tokenStocke) {
      // Cookie HTTPOnly éventuel (PWA / nouvel onglet)
      const refreshed = await rafraichirToken();
      if (!refreshed) setUser(null);
      return;
    }

    const payload = parseJwt(tokenStocke);
    const maintenant = Date.now() / 1000;
    if (payload && typeof (payload as any).exp === "number" && (payload as any).exp > maintenant) {
      setAccessToken(tokenStocke);
      try {
        const me = await authApi.me();
        setUser(me);
      } catch {
        await rafraichirToken();
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
    localStorage.removeItem("access_token");
    localStorage.removeItem("terrainsn_token");
    localStorage.removeItem("terrainsn_user");
    setUser(null);
    setAccessToken(null);
    if (redirect && typeof window !== "undefined") {
      const path = window.location.pathname || "";
      if (path.startsWith("/backoffice")) {
        window.location.href = "/backoffice/login";
      } else {
        window.location.href = "/login";
      }
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

  const setSession = (nextUser: User, token?: string) => {
    setUser(nextUser);
    if (token) {
      localStorage.setItem("access_token", token);
      localStorage.setItem("terrainsn_token", token);
      setAccessToken(token);
    } else {
      setAccessToken(readStoredAccessToken());
    }
  };

  const login = async (identifier: string, password: string) => {
    setLoading(true);
    try {
      const result = await authApi.smartLogin(identifier, password);
      const token = result.accessToken || result.token || readStoredAccessToken();
      setUser(result.user);
      if (token) setAccessToken(token);
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
      setUser(data);
      return data;
    } catch {
      setUser(null);
      await deconnecter(false);
    }
  };

  const logout = async () => {
    await deconnecter(true);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        accessToken,
        isAuthenticated: !!user,
        loading,
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
