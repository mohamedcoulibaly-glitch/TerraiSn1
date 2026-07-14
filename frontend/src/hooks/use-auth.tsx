import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { authApi } from "@/lib/api";

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
  isAuthenticated: boolean;
  loading: boolean;
  login: (identifier: string, password: string) => Promise<User>;
  setSession: (user: User, token?: string) => void;
  register: (data: { nom: string; email: string; password: string; telephone: string }) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(authApi.getUser());
  const [loading, setLoading] = useState(true);

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
      authApi.logout();
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (authApi.isAuthenticated()) {
          const data = await authApi.me();
          if (!cancelled) setUser(data);
        } else if (!cancelled) {
          setUser(null);
        }
      } catch {
        if (!cancelled) {
          setUser(null);
          authApi.logout();
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setSession = (nextUser: User, _token?: string) => {
    setUser(nextUser);
  };

  const login = async (identifier: string, password: string) => {
    setLoading(true);
    try {
      const result = await authApi.smartLogin(identifier, password);
      setUser(result.user);
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
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    authApi.logout();
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{ user, isAuthenticated: !!user, loading, login, setSession, register, logout, refreshUser }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth doit être utilisé dans un AuthProvider");
  return ctx;
}
