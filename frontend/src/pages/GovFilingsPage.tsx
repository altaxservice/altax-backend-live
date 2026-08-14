import { useEffect, useState } from "react";
import { api, ApiError, viewFile } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { StatusBadge } from "../components/StatusBadge";
import { ErrorBanner } from "../components/ErrorBanner";
import { useToast } from "../components/Toast";
import { fmtDateOnly as fmtDate } from "../utils/date";
import { GOV_FORM_LABELS, type GovFormType } from "../api/govForms";

interface PortalGovFiling {
  filing_id: string;
  form_type: GovFormType;
  status: string;
  signed_at: string | null;
  submitted_via: string | null;
  submitted_at: string | null;
  created_at: string;
}

/**
 * UX-012 (Hard Audit, 2026-08-13) — same read-only pattern as AgreementsPage:
 * the firm generates and (for these forms) signs SS-4/2553/W-9/8832/CRA/8822-B
 * on the client's behalf, but the client previously had no portal view of
 * what's actually on file. Backend (GET /gov-forms/mine, GET
 * /gov-forms/mine/:filingId/pdf) already scopes to the caller's own
 * client_id and excludes Drafts. Nothing to sign or edit here — those are
 * staff-only actions on ClientDetailPage.
 */
export function GovFilingsPage() {
  const { user } = useAuth();
  const toast = useToast();
  const clientId = user?.clientId || "";
  const [filings, setFilings] = useState<PortalGovFiling[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!clientId) return;
    api.get<{ filings: PortalGovFiling[] }>("/gov-forms/mine")
      .then((res) => setFilings(res.filings))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load your filings."));
  }, [clientId]);

  async function handleView(filingId: string) {
    try {
      await viewFile(`/gov-forms/mine/${filingId}/pdf`);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not open this document.");
    }
  }

  if (error) return <ErrorBanner error={error} />;

  return (
    <div>
      <div className="portal-banner">
        <div>
          <h2>Government Filings</h2>
          <p>Federal and state registration forms the firm has prepared on your business's behalf.</p>
        </div>
      </div>

      {filings === null && <div className="spinner-wrap">Loading…</div>}

      {filings !== null && filings.length === 0 && (
        <div className="card" style={{ padding: 24, textAlign: "center" }}>
          <p className="muted">No filings on file yet.</p>
        </div>
      )}

      {filings !== null && filings.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div className="table-scroll card-table">
            <table>
              <thead>
                <tr>
                  <th scope="col">Form</th>
                  <th scope="col">Status</th>
                  <th scope="col">Signed</th>
                  <th scope="col">Submitted</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {filings.map((f) => (
                  <tr key={f.filing_id} data-row-id={f.filing_id} tabIndex={0} onClick={() => handleView(f.filing_id)} style={{ cursor: "pointer" }} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleView(f.filing_id); } }}>
                    <td data-label="Form"><span className="link-button" style={{ fontWeight: 600 }}>{GOV_FORM_LABELS[f.form_type] || f.form_type}</span></td>
                    <td data-label="Status"><StatusBadge status={f.status} /></td>
                    <td className="muted" data-label="Signed">{f.signed_at ? fmtDate(f.signed_at) : "—"}</td>
                    <td className="muted" data-label="Submitted">{f.submitted_at ? `${fmtDate(f.submitted_at)}${f.submitted_via ? ` — ${f.submitted_via}` : ""}` : "—"}</td>
                    <td data-label="Action" onClick={(e) => e.stopPropagation()}>
                      <button type="button" className="btn btn-sm" onClick={() => handleView(f.filing_id)}>View PDF</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
