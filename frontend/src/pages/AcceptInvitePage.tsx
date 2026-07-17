import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../api/client";
import { APP_NAME } from "../utils/branding";
import { FirmLogo } from "../components/FirmLogo";

export function AcceptInvitePage() {
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState(searchParams.get("email") || "");
  const [token] = useState(searchParams.get("invite") || searchParams.get("token") || "");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setSubmitting(true);
    try {
      await api.post("/auth/accept-invite", { email, token, password });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-screen">
      <div className="login-panel">
        <div className="login-brand">
          <FirmLogo size={40} />
          <div>
            <div style={{ fontWeight: 800, fontSize: 15 }}>Set Up Your Account</div>
            <div className="muted" style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase" }}>{APP_NAME}</div>
          </div>
        </div>

        {done ? (
          <>
            <h1>Password Created</h1>
            <p className="login-copy">Your account is ready. You can sign in now.</p>
            <Link to="/login" className="btn btn-primary" style={{ width: "100%", justifyContent: "center", textDecoration: "none" }}>
              Go to Sign In
            </Link>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <h1>Set Up Your Account</h1>
            <p className="login-copy">Enter the email your invite was sent to and choose a password.</p>

            {error && <div className="error-banner">{error}</div>}

            {!token && (
              <div className="error-banner">
                This link is missing its setup token. Ask an admin to resend your invite and use the exact link they send.
              </div>
            )}

            <div className="field">
              <label htmlFor="ai-email">Email</label>
              <input id="ai-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
            </div>
            <div className="field">
              <label htmlFor="ai-password">New Password</label>
              <input id="ai-password" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="ai-confirm">Confirm Password</label>
              <input id="ai-confirm" type="password" required minLength={8} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
            </div>

            <button type="submit" className="btn btn-primary" style={{ width: "100%", justifyContent: "center", marginTop: 4 }} disabled={submitting || !token}>
              {submitting ? "Setting up…" : "Create Password"}
            </button>

            <div className="login-help-box">
              Already set up? <Link to="/login">Sign in here</Link> instead.
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
