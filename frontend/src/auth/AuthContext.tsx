import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, setAuthToken, getAuthToken } from "../api/client";
import type { AuthUser, LoginResponse, LoginStepResponse } from "../api/types";

export type LoginOutcome = { totpRequired: true; challenge: string } | { totpRequired: false };

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, portal: string, password: string) => Promise<LoginOutcome>;
  completeTotpLogin: (challenge: string, code: string) => Promise<void>;
  updateUser: (patch: Partial<AuthUser>) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const USER_STORAGE_KEY = "altax_user";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = getAuthToken();
    const storedUser = localStorage.getItem(USER_STORAGE_KEY);
    if (token && storedUser) {
      try {
        setUser(JSON.parse(storedUser));
      } catch {
        setAuthToken(null);
      }
    }
    setLoading(false);
  }, []);

  const login = useCallback(async (email: string, portal: string, password: string): Promise<LoginOutcome> => {
    const result = await api.post<LoginStepResponse>("/auth/login", { email, portal, password });
    if ("totpRequired" in result) {
      return { totpRequired: true, challenge: result.challenge };
    }
    setAuthToken(result.token);
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(result.user));
    setUser(result.user);
    return { totpRequired: false };
  }, []);

  const completeTotpLogin = useCallback(async (challenge: string, code: string) => {
    const result = await api.post<LoginResponse>("/auth/login/verify-totp", { challenge, code });
    setAuthToken(result.token);
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(result.user));
    setUser(result.user);
  }, []);

  const updateUser = useCallback((patch: Partial<AuthUser>) => {
    setUser((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const logout = useCallback(() => {
    setAuthToken(null);
    localStorage.removeItem(USER_STORAGE_KEY);
    setUser(null);
  }, []);

  return <AuthContext.Provider value={{ user, loading, login, completeTotpLogin, updateUser, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
