import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { ApiError } from "../api/client";
import { APP_NAME } from "../utils/branding";
import { useLanguage } from "../context/LanguageContext";
import { FirmLogo } from "../components/FirmLogo";

const PORTALS = [
  { value: "admin", label: "Admin Portal", description: "Firm owner and admin tools" },
  { value: "staff", label: "Staff Portal", description: "Assigned work queue" },
  { value: "client", label: "Client Portal", description: "Billing, documents, messages" },
  { value: "employee", label: "Employee Portal", description: "Paystubs and employee messages" },
];

const PORTAL_COPY: Record<string, string> = {
  admin: "Use the firm admin account for operations, setup, billing, rules, and portal access.",
  staff: "Sign in with your staff account to see your assigned clients and work queue.",
  client: "Sign in to view your invoices, documents, and messages with the firm.",
  employee: "Sign in to view your paystubs and messages from the firm.",
};

export function LoginPage() {
  const { login, completeTotpLogin } = useAuth();
  const navigate = useNavigate();
  const { lang, setLang, t, dir } = useLanguage();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [portal, setPortal] = useState("admin");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState("");

  const portalLabel = PORTALS.find((p) => p.value === portal)?.label || "Portal";
  const showLanguageToggle = portal === "client" || portal === "employee";
  const formDir = showLanguageToggle ? dir : "ltr";

  useEffect(() => {
    document.title = `Sign In · ${portalLabel} – ${APP_NAME}`;
  }, [portalLabel]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const outcome = await login(email, portal, password);
      if (outcome.totpRequired) {
        setChallenge(outcome.challenge);
      } else {
        navigate("/", { replace: true });
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerifyCode(e: FormEvent) {
    e.preventDefault();
    if (!challenge) return;
    setError(null);
    setSubmitting(true);
    try {
      await completeTotpLogin(challenge, code);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    } finally {
      setSubmitting(false);
    }
  }

  if (challenge) {
    return (
      <div className="login-screen">
        <form onSubmit={handleVerifyCode} className="login-panel">
          <div className="login-brand">
            <FirmLogo size={40} />
            <div>
              <div style={{ fontWeight: 800, fontSize: 15 }}>Secure Portal</div>
              <div className="muted" style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase" }}>{APP_NAME}</div>
            </div>
          </div>

          <h1>Enter Authenticator Code</h1>
          <p className="login-copy">Open your authenticator app and enter the current 6-digit code for this account.</p>

          {error && <div className="error-banner">{error}</div>}

          <div className="field">
            <label htmlFor="totp-code">6-digit code</label>
            <input
              id="totp-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              required
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              autoFocus
              style={{ letterSpacing: 4, fontSize: 18, textAlign: "center" }}
            />
          </div>

          <button type="submit" className="btn btn-primary" style={{ width: "100%", justifyContent: "center", marginTop: 4 }} disabled={submitting || code.length !== 6}>
            {submitting ? "Verifying…" : "Verify & Sign In"}
          </button>

          <button
            type="button"
            className="btn btn-sm"
            style={{ marginTop: 8 }}
            onClick={() => { setChallenge(null); setCode(""); setError(null); }}
          >
            Back to sign in
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="login-screen">
      <form onSubmit={handleSubmit} className="login-panel" dir={formDir}>
        <div className="login-brand" style={{ justifyContent: "space-between" }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <FirmLogo size={40} />
            <div>
              <div style={{ fontWeight: 800, fontSize: 15 }}>Secure Portal</div>
              <div className="muted" style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase" }}>{APP_NAME}</div>
            </div>
          </div>
          {showLanguageToggle && (
            <div role="group" aria-label={t("header.language")} style={{ display: "flex", border: "1px solid var(--line)", borderRadius: 8, overflow: "hidden" }}>
              <button type="button" className="btn btn-sm" style={{ borderRadius: 0, border: "none", fontWeight: lang === "en" ? 800 : 500 }} onClick={() => setLang("en")}>EN</button>
              <button type="button" className="btn btn-sm" style={{ borderRadius: 0, border: "none", fontWeight: lang === "ar" ? 800 : 500 }} onClick={() => setLang("ar")}>عربي</button>
            </div>
          )}
        </div>

        <h1>{portal === "client" ? t("login.clientPortal") : portal === "employee" ? t("login.employeePortal") : portalLabel} {showLanguageToggle ? "" : "Sign In"}</h1>
        <p className="login-copy">{portal === "client" ? t("login.clientCopy") : portal === "employee" ? t("login.employeeCopy") : PORTAL_COPY[portal]}</p>

        {error && <div className="error-banner">{error}</div>}

        <div className="login-role-grid">
          {PORTALS.map((p) => (
            <button
              type="button"
              key={p.value}
              className={`login-role-option ${portal === p.value ? "active" : ""}`}
              onClick={() => setPortal(p.value)}
            >
              <strong>{p.label}</strong>
              <span>{p.description}</span>
            </button>
          ))}
        </div>

        <div className="field">
          <label htmlFor="email">{showLanguageToggle ? t("login.email") : "Email"}</label>
          <input id="email" type="email" placeholder="name@example.com" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus dir="ltr" />
        </div>

        <div className="field">
          <label htmlFor="password">{showLanguageToggle ? t("login.password") : "Password"}</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              id="password"
              type={showPassword ? "text" : "password"}
              placeholder="Required after account setup"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{ flex: 1 }}
              dir="ltr"
            />
            <button type="button" className="btn btn-sm" onClick={() => setShowPassword((v) => !v)}>
              {showLanguageToggle ? (showPassword ? t("login.hidePassword") : t("login.showPassword")) : (showPassword ? "Hide" : "Show")}
            </button>
          </div>
        </div>

        <button type="submit" className="btn btn-primary" style={{ width: "100%", justifyContent: "center", marginTop: 4 }} disabled={submitting}>
          {showLanguageToggle
            ? (submitting ? t("login.signingIn") : t("login.signIn"))
            : (submitting ? "Signing in…" : `Sign In to ${portalLabel}`)}
        </button>

        <div className="login-help-box">
          <strong style={{ color: "var(--ink)" }}>First login?</strong> Ask an admin to set a temporary password or send
          you an invite link. Temporary passwords open the portal once, then ask you to create your own.
        </div>
      </form>
    </div>
  );
}
