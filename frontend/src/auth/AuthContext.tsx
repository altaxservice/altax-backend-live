import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, setAuthToken, getAuthToken } from "../api/client";
import type { AuthUser, LoginResponse, LoginStepResponse } from "../api/types";

export type LoginOutcome =
  | { step: "totp"; challenge: string }
  | { step: "enroll"; challenge: string; email: string }
  | { step: "emailOtp"; challenge: string; email: string }
  | { step: "done" };

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, portal: string, password: string) => Promise<LoginOutcome>;
  completeTotpLogin: (challenge: string, code: string) => Promise<void>;
  /** Client/Employee portals: verify the 6-digit code that was emailed. */
  completeEmailOtpLogin: (challenge: string, code: string) => Promise<void>;
  /** Send a fresh email code for an in-flight sign-in. */
  resendEmailOtp: (challenge: string) => Promise<void>;
  /** Mandatory-enrollment step 1: fetch a QR + secret for a user with no authenticator yet. */
  startTotpEnrollment: (challenge: string) => Promise<{ secret: string; qrCodeDataUrl: string }>;
  /**
   * Mandatory-enrollment step 2: verify the first code, which also signs the
   * user in. Returns the one-time recovery codes — the only moment they are
   * ever readable, so the caller must show them before navigating away.
   */
  completeTotpEnrollment: (challenge: string, code: string) => Promise<string[]>;
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

  const applySession = useCallback((result: LoginResponse) => {
    setAuthToken(result.token);
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(result.user));
    setUser(result.user);
  }, []);

  const login = useCallback(async (email: string, portal: string, password: string): Promise<LoginOutcome> => {
    const result = await api.post<LoginStepResponse>("/auth/login", { email, portal, password });
    if ("totpRequired" in result) return { step: "totp", challenge: result.challenge };
    // Portals covered by a second-factor policy never get a session straight
    // from a password: authenticator portals go to enrollment, email-code
    // portals go to the code screen. Neither branch can be skipped.
    if ("enrollmentRequired" in result) return { step: "enroll", challenge: result.challenge, email: result.email };
    if ("emailOtpRequired" in result) return { step: "emailOtp", challenge: result.challenge, email: result.email };
    applySession(result);
    return { step: "done" };
  }, [applySession]);

  const completeTotpLogin = useCallback(async (challenge: string, code: string) => {
    applySession(await api.post<LoginResponse>("/auth/login/verify-totp", { challenge, code }));
  }, [applySession]);

  const completeEmailOtpLogin = useCallback(async (challenge: string, code: string) => {
    applySession(await api.post<LoginResponse>("/auth/login/verify-email-code", { challenge, code }));
  }, [applySession]);

  const resendEmailOtp = useCallback(async (challenge: string) => {
    await api.post("/auth/login/resend-email-code", { challenge });
  }, []);

  const startTotpEnrollment = useCallback(async (challenge: string) => {
    return api.post<{ secret: string; qrCodeDataUrl: string }>("/auth/enroll/2fa/start", { challenge });
  }, []);

  const completeTotpEnrollment = useCallback(async (challenge: string, code: string) => {
    const result = await api.post<LoginResponse & { backupCodes?: string[] }>("/auth/enroll/2fa/confirm", { challenge, code });
    applySession(result);
    return result.backupCodes || [];
  }, [applySession]);

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

  return (
    <AuthContext.Provider
      value={{ user, loading, login, completeTotpLogin, completeEmailOtpLogin, resendEmailOtp, startTotpEnrollment, completeTotpEnrollment, updateUser, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
