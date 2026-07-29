import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../api/client";
import { APP_NAME } from "../utils/branding";
import { FirmLogo } from "../components/FirmLogo";
import { ErrorBanner } from "../components/ErrorBanner";

/**
 * Where a portal sign-in email change is completed — the landing page for the link
 * mailed to the NEW address after staff request the change on the client's profile.
 *
 * Deliberately a button rather than an on-load POST: mail scanners and link
 * previewers fetch URLs in the background, and a change this consequential should
 * take a human clicking it. Public, because the person confirming can't sign in yet
 * — the address isn't the account's sign-in email until this succeeds.
 */
export function ConfirmEmailChangePage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ email: string } | null>(null);

  async function confirm() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await api.post<{ ok: boolean; email: string }>("/auth/confirm-email-change", { token });
      setDone({ email: res.email });
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
            <div style={{ fontWeight: 800, fontSize: 15 }}>Confirm Your Email</div>
            <div className="muted" style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase" }}>{APP_NAME}</div>
          </div>
        </div>

        {done ? (
          <>
            <h1>Email Confirmed</h1>
            <p className="login-copy">
              From now on, sign in with <strong>{done.email}</strong>. Your password has not changed.
            </p>
            <Link to="/login/client" className="btn btn-primary" style={{ width: "100%", justifyContent: "center", textDecoration: "none" }}>
              Go to Sign In
            </Link>
          </>
        ) : (
          <>
            <h1>Confirm Your Email</h1>
            <p className="login-copy">
              Confirm this address as your new AL TAX portal sign-in email. Your password and everything in your
              portal stay exactly as they are.
            </p>

            {error && <ErrorBanner error={error} />}

            {!token && (
              <div className="error-banner">
                This link is missing its confirmation code. Use the exact link from the email we sent you.
              </div>
            )}

            <button
              type="button"
              className="btn btn-primary"
              style={{ width: "100%", justifyContent: "center", marginTop: 4 }}
              disabled={submitting || !token}
              onClick={confirm}
            >
              {submitting ? "Confirming…" : "Confirm This Email"}
            </button>

            <div className="login-help-box">
              Didn't ask for this? Ignore this page and tell us — nothing changes until you confirm.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
