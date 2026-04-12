import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { authApi } from '@/lib/api';

interface User {
  id: number;
  nom: string;
  email: string;
  telephone?: string;
  role: string;
  accountType?: string;
  [key: string]: any;
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  loading: boolean;
  login: (email: string, password: string, accountType?: string) => Promise<void>;
  register: (data: { nom: string; email: string; password: string; telephone: string }) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(authApi.getUser());
  const [loading, setLoading] = useState(false);

  const refreshUser = async () => {
    if (!authApi.isAuthenticated()) return;
    try {
      const data = await authApi.me();
      setUser(data);
    } catch {
      setUser(null);
      authApi.logout();
    }
  };

  useEffect(() => {
    if (authApi.isAuthenticated() && !user) {
      refreshUser();
    }
  }, []);

  const login = async (email: string, password: string, accountType?: string) => {
    setLoading(true);
    try {
      const result = await authApi.login({ email, password, accountType });
      setUser(result.user);
    } finally {
      setLoading(false);
    }
  };

  const register = async (data: { nom: string; email: string; password: string; telephone: string }) => {
    setLoading(true);
    try {
      const result = await authApi.register(data);
      setUser(result.user);
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    authApi.logout();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: !!user, loading, login, register, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth doit être utilisé dans un AuthProvider');
  return ctx;
}
