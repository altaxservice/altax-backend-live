import { useEffect, useState } from "react";
import { api, ApiError, viewFile } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { StatusBadge } from "../components/StatusBadge";
import { ErrorBanner } from "../components/ErrorBanner";
import { useToast } from "../components/Toast";
import { fmtDateOnly as fmtDate } from "../utils/date";

interface PortalContract {
  contract_id: string;
  title: string;
  fee_amount: number | string | null;
  fee_description: string | null;
  effective_date: string | null;
  status: string;
  signer_name: string | null;
  signed_at: string | null;
  sent_at: string | null;
}

function fmtMoney(v: unknown): string {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—";
}

/**
 * UX-011 (Hard Audit, 2026-08-13) — signed contracts were only ever reachable
 * via the original one-time emailed public link (PublicContractPage.tsx);
 * once that link was lost or the tab closed, a client had no way back into
 * their own agreements from the authenticated portal at all. The backend
 * routes this reuses (GET /contracts/client/:clientId, GET /contracts/:id/pdf)
 * already had correct canAccessClient scoping for the "client" role from day
 * one — this page is the missing frontend consumer, not a new access path.
 * Read-only by design: signing itself still only happens through the
 * dedicated emailed/in-person flow, so there's no action here to re-sign or
 * edit, just to view/download what's already on file.
 */
export function AgreementsPage() {
  const { user } = useAuth();
  const toast = useToast();
  const clientId = user?.clientId || "";
  const [contracts, setContracts] = useState<PortalContract[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!clientId) return;
    api.get<{ contracts: PortalContract[] }>(`/contracts/client/${clientId}`)
      .then((res) => setContracts(res.contracts))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load your agreements."));
  }, [clientId]);

  async function handleView(contractId: string) {
    try {
      await viewFile(`/contracts/${contractId}/pdf`);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not open this document.");
    }
  }

  if (error) return <ErrorBanner error={error} />;

  return (
    <div>
      <div className="portal-banner">
        <div>
          <h2>Agreements</h2>
          <p>Engagement letters and authorization forms on file with the firm.</p>
        </div>
      </div>

      {contracts === null && <div className="spinner-wrap">Loading…</div>}

      {contracts !== null && contracts.length === 0 && (
        <div className="card" style={{ padding: 24, textAlign: "center" }}>
          <p className="muted">No agreements on file yet.</p>
        </div>
      )}

      {contracts !== null && contracts.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div className="table-scroll card-table">
            <table>
              <thead>
                <tr>
                  <th scope="col">Document</th>
                  <th scope="col">Fee</th>
                  <th scope="col">Status</th>
                  <th scope="col">Signed</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {contracts.map((c) => (
                  <tr key={c.contract_id} data-row-id={c.contract_id} tabIndex={0} onClick={() => handleView(c.contract_id)} style={{ cursor: "pointer" }} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleView(c.contract_id); } }}>
                    <td data-label="Document"><span className="link-button" style={{ fontWeight: 600 }}>{c.title}</span></td>
                    <td className="muted" data-label="Fee">{fmtMoney(c.fee_amount) !== "—" ? fmtMoney(c.fee_amount) : (c.fee_description || "—")}</td>
                    <td data-label="Status"><StatusBadge status={c.status} /></td>
                    <td className="muted" data-label="Signed">{c.signed_at ? `${fmtDate(c.signed_at)}${c.signer_name ? ` — ${c.signer_name}` : ""}` : "—"}</td>
                    <td data-label="Action" onClick={(e) => e.stopPropagation()}>
                      <button type="button" className="btn btn-sm" onClick={() => handleView(c.contract_id)}>View PDF</button>
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
