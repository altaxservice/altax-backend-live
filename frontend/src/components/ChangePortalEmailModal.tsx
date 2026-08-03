import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, ApiError } from "../api/client";
import type { PortalUser } from "../api/types2";
import { useToast } from "./Toast";
import { ErrorBanner } from "./ErrorBanner";
import { useConfirm } from "./ConfirmProvider";
import { useEscapeToClose } from "../hooks/useEscapeToClose";
import { useFocusTrap } from "../hooks/useFocusTrap";

interface RequestResult {
  pendingEmail: string;
  confirmationEmailed: boolean;
  confirmationEmailError?: string;
  confirmLink: string;
}

/**
 * Changes the email a client signs in to their portal with.
 *
 * Staff request it here; it does NOT take effect until someone at the new address
 * clicks the confirmation link mailed to them. That protects against the two ways
 * this goes wrong: a mistyped address (dictated over the phone) would otherwise
 * lock the client out permanently and send their password resets to a stranger,
 * and "please change my login to <address>" is exactly what an account takeover
 * looks like. The old address is always notified either way.
 *
 * Finds the client's portal account by assigned_client_id rather than assuming the
 * usr_<clientId> naming, since accounts created through Users & Access don't follow it.
 */
export function ChangePortalEmailModal({ clientId, clientName, contactEmail, onClose, onDone }: {
  clientId: string;
  clientName: string;
  contactEmail: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  useEscapeToClose(onClose);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef);
  const toast = useToast();
  const confirmDialog = useConfirm();
  const [user, setUser] = useState<PortalUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [newEmail, setNewEmail] = useState("");
  const [syncContact, setSyncContact] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RequestResult | null>(null);

  function loadUser() {
    setLoading(true);
    api.get<{ users: PortalUser[] }>("/users")
      .then((res) => {
        const match = res.users.find(
          (u) => u.assigned_client_id === clientId && String(u.role || "").toLowerCase() === "client"
        );
        setUser(match || null);
        if (!match) setError("This client has no portal account yet. Send them a portal invitation first.");
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load the portal account."))
      .finally(() => setLoading(false));
  }

  useEffect(loadUser, [clientId]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    setSaving(true);
    setError(null);
    try {
      const res = await api.post<RequestResult>(`/users/${user.user_id}/request-email-change`, {
        newEmail: newEmail.trim(),
        syncContact,
      });
      setResult(res);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not request the email change.");
    } finally {
      setSaving(false);
    }
  }

  async function handleCancelPending() {
    if (!user) return;
    const ok = await confirmDialog({ title: "Cancel pending change", message: "The client keeps signing in with their current address." });
    if (!ok) return;
    setSaving(true);
    try {
      await api.post(`/users/${user.user_id}/cancel-email-change`, {});
      toast("Pending email change cancelled.");
      setResult(null);
      loadUser();
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not cancel the pending change.");
    } finally {
      setSaving(false);
    }
  }

  const pending = user?.pending_email || null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div ref={panelRef} className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="change-portal-email-title" style={{ maxWidth: 520, width: "94vw" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 id="change-portal-email-title">Change Sign-In Email</h2>
          <button className="btn btn-sm" onClick={onClose}>Close</button>
        </div>

        {error && <ErrorBanner error={error} />}

        {loading ? (
          <p className="muted">Loading portal account…</p>
        ) : result ? (
          <>
            <p>
              Confirmation sent to <strong>{result.pendingEmail}</strong>. The sign-in email changes as soon as they
              open it — until then, {clientName} keeps signing in with <strong>{user?.email}</strong>.
            </p>
            {!result.confirmationEmailed && (
              <div className="card" style={{ marginTop: 12, borderColor: "var(--teal)" }}>
                <strong>Email not sent{result.confirmationEmailError ? `: ${result.confirmationEmailError}` : "."}</strong>
                <div className="muted" style={{ fontSize: 12, margin: "6px 0" }}>Send them this link yourself:</div>
                <div style={{ wordBreak: "break-all", fontFamily: "monospace", fontSize: 12 }}>{result.confirmLink}</div>
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
              <button type="button" className="btn btn-primary" onClick={onClose}>Done</button>
            </div>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="field">
              <label>Signs in now with</label>
              <div style={{ padding: "8px 10px", border: "1px solid var(--line)", borderRadius: 8, fontWeight: 700 }}>
                {user?.email || "—"}
              </div>
            </div>

            {pending && (
              <div className="card" style={{ marginBottom: 12, borderColor: "var(--teal)" }}>
                <strong>Waiting on confirmation</strong>
                <div style={{ fontSize: 13, marginTop: 4 }}>
                  A change to <strong>{pending}</strong> was already requested. It takes effect when that address
                  confirms it. Requesting a different address below replaces it.
                </div>
                <button type="button" className="btn btn-sm" style={{ marginTop: 10 }} disabled={saving} onClick={handleCancelPending}>
                  Cancel Pending Change
                </button>
              </div>
            )}

            <div className="field">
              <label htmlFor="ce-email">New sign-in email</label>
              <input
                id="ce-email" type="email" required autoFocus
                value={newEmail} onChange={(e) => setNewEmail(e.target.value)}
                placeholder="name@example.com"
                disabled={!user}
              />
            </div>

            <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, margin: "4px 0 12px" }}>
              <input type="checkbox" checked={syncContact} onChange={(e) => setSyncContact(e.target.checked)} style={{ marginTop: 3 }} />
              <span>
                Also use this address for invoices and notifications
                {contactEmail ? <span className="muted"> (now {contactEmail})</span> : null}
              </span>
            </label>

            <p className="muted" style={{ fontSize: 12, margin: "0 0 12px" }}>
              We email the new address to confirm, and tell the current one that a change was requested. Nothing
              changes until it is confirmed, so a wrong address can't lock {clientName} out.
            </p>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" className="btn" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving || !user || !newEmail.trim()}>
                {saving ? "Sending…" : "Send Confirmation"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
