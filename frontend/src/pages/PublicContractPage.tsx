import { useEffect, useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { api, ApiError, resolveFileUrl } from "../api/client";
import { ContractBodyText } from "../components/ContractBodyText";

interface PublicContract {
  contract_id: string; title: string; rendered_body: string; effective_date: string | null;
  status: string; client_name: string; signer_name: string | null; signed_at: string | null;
}

function fmtDate(v: unknown): string {
  if (!v) return "—";
  const d = new Date(v as string);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

/**
 * Public, no-login contract view + e-sign page — the destination of a contract's
 * "Send to Client"/"Copy Link" action. Deliberately outside <ProtectedRoute> in
 * App.tsx, same as PublicInvoicePage: access is gated by the opaque token in the
 * URL, so a brand-new client can review and sign before any portal account
 * exists for them — matches the real intake workflow (contract signed first,
 * portal invite sent after).
 */
export function PublicContractPage() {
  const { token } = useParams<{ token: string }>();
  const [contract, setContract] = useState<PublicContract | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"sign" | null>(null);
  const [signerName, setSignerName] = useState("");
  const [signerTitle, setSignerTitle] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [signError, setSignError] = useState<string | null>(null);
  const [justSigned, setJustSigned] = useState(false);

  function load() {
    if (!token) return;
    api.get<{ contract: PublicContract }>(`/public/contracts/${token}`)
      .then((r) => setContract(r.contract))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load this contract."));
  }
  useEffect(load, [token]);

  async function handleSign(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setSignError(null);
    setBusy("sign");
    try {
      await api.post(`/public/contracts/${token}/sign`, { signerName, signerTitle, agreed });
      setJustSigned(true);
      load();
    } catch (err) {
      setSignError(err instanceof ApiError ? err.message : "Could not save your signature.");
    } finally {
      setBusy(null);
    }
  }

  // This page has no app chrome (sidebar/nav) — it's usually opened as its own
  // tab from an emailed link, so there's otherwise no way for the client to
  // signal "I'm done" other than closing the tab themselves. window.close()
  // only succeeds for a tab with no browsing history of its own (exactly the
  // case for a link opened fresh from an email client) — if the browser blocks
  // it, nothing bad happens, the client just closes the tab manually.
  function handleClose() {
    window.close();
  }

  const pageStyle = { maxWidth: 720, margin: "40px auto", padding: "0 20px", fontFamily: "inherit" };

  if (error) return <div style={pageStyle}><div className="error-banner">{error}</div></div>;
  if (!contract) return <div style={pageStyle}><div className="spinner-wrap">Loading…</div></div>;

  const isSigned = contract.status === "Signed";
  // Plain links, not the app's usual authed blob-fetch pattern (viewFile/downloadFile) —
  // this route needs no auth, and iOS Safari/Gmail's in-app browser have shown blank
  // pages when navigating a new window to a blob: URL created in a different one.
  // A real network URL avoids that entirely and works everywhere.
  const pdfUrl = resolveFileUrl(`/public/contracts/${token}/pdf`);

  return (
    <div style={pageStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ fontSize: 12, letterSpacing: 1, textTransform: "uppercase", color: "var(--muted-fg, #6b7280)" }}>{contract.client_name}</div>
          <h1 style={{ fontSize: 22, margin: "4px 0 0" }}>{contract.title}</h1>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <a className="btn" href={pdfUrl} target="_blank" rel="noopener noreferrer">View PDF</a>
          <a className="btn btn-primary" href={pdfUrl} download={`${contract.contract_id}.pdf`}>Download PDF</a>
          <button className="btn" onClick={handleClose}>Close Window</button>
        </div>
      </div>
      <p className="muted" style={{ fontSize: 13, marginBottom: 20 }}>
        Contract {contract.contract_id}{contract.effective_date ? ` · Effective ${fmtDate(contract.effective_date)}` : ""}
      </p>

      {isSigned && (
        <div className="card" style={{ marginBottom: 20, borderColor: "var(--teal)" }}>
          <strong>This contract has been electronically signed.</strong>
          <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
            Signed by {contract.signer_name} on {fmtDate(contract.signed_at)}.
          </div>
        </div>
      )}

      {/* No inner scroll cap here on purpose: this document includes a full Arabic
          translation appended after the English text (see contractContent.ts) — a
          capped, separately-scrolling box made that section easy to miss entirely,
          which defeats the point of translating it. The whole thing scrolls with the
          page instead, like any other document a client has to actually read before
          signing. */}
      <div className="card" style={{ marginBottom: 20 }}>
        <ContractBodyText text={contract.rendered_body} style={{ fontSize: 13.5, lineHeight: 1.7 }} />
      </div>

      {!isSigned && (
        justSigned ? (
          <div className="card" style={{ borderColor: "var(--teal)" }}>
            <strong>Thank you — your signature has been recorded.</strong>
            <p className="muted" style={{ marginTop: 6 }}>A copy of this signed agreement is available above via View PDF or Download PDF. You're all done — you can close this window now.</p>
            <button className="btn" style={{ marginTop: 10 }} onClick={handleClose}>Close Window</button>
          </div>
        ) : (
          <form onSubmit={handleSign} className="card">
            <h2 style={{ fontSize: 15, margin: "0 0 4px" }}>Sign this agreement</h2>
            <p className="muted" style={{ fontSize: 12.5, marginBottom: 14 }}>
              Typing your name below and checking the box acts as your electronic signature and has the same legal effect as a handwritten signature.
            </p>
            {signError && <div className="error-banner">{signError}</div>}
            <div className="field"><label htmlFor="sign-name">Full Legal Name</label><input id="sign-name" required value={signerName} onChange={(e) => setSignerName(e.target.value)} /></div>
            <div className="field"><label htmlFor="sign-title">Title (optional)</label><input id="sign-title" value={signerTitle} onChange={(e) => setSignerTitle(e.target.value)} placeholder="e.g. Owner" /></div>
            <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, margin: "10px 0 14px" }}>
              <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} style={{ marginTop: 3 }} />
              I have read this agreement in full and agree to its terms.
            </label>
            <button type="submit" className="btn btn-primary" disabled={busy === "sign" || !signerName.trim() || !agreed}>
              {busy === "sign" ? "Signing…" : "Sign Agreement"}
            </button>
          </form>
        )
      )}
    </div>
  );
}
