import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { Client } from "../api/types";
import { StatusBadge } from "./StatusBadge";
import { useSelectedClient } from "../context/SelectedClientContext";

interface Summary {
  openTasks: number;
  taskStatusBreakdown: { status: string; count: number }[];
  openRequests: number;
  openInvoices: number;
  balanceDue: number;
  employeesCount: number;
  documentsCount: number;
}

function fmtMoney(v: unknown): string {
  const n = Number(v);
  return Number.isFinite(n) ? `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "$0.00";
}

export function ClientContextPanel() {
  const { clientId, clientName, setSelectedClient, panelHidden, setPanelHidden } = useSelectedClient();
  const navigate = useNavigate();
  const [client, setClient] = useState<Client | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => {
    if (!clientId) {
      setClient(null);
      setSummary(null);
      return;
    }
    let cancelled = false;
    api.get<{ client: Client }>(`/clients/${clientId}`).then((res) => { if (!cancelled) setClient(res.client); }).catch(() => { if (!cancelled) setClient(null); });
    api.get<Summary>(`/clients/${clientId}/summary`).then((res) => { if (!cancelled) setSummary(res); }).catch(() => { if (!cancelled) setSummary(null); });
    return () => { cancelled = true; };
  }, [clientId]);

  if (!clientId) return null;

  // Hidden, but still selected — leave a way back in. Without this the ✕ was a
  // one-way door: the panel vanished and nothing on screen could bring it back.
  if (panelHidden) {
    return (
      <button
        type="button"
        className="client-panel-reopen"
        onClick={() => setPanelHidden(false)}
        title={`Show client panel — ${clientName || clientId}`}
      >
        <span aria-hidden="true">‹</span>
        <span className="client-panel-reopen-label">{clientName || clientId}</span>
      </button>
    );
  }

  return (
    <aside className="client-panel">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4, gap: 6 }}>
        <div className="small-label" style={{ color: "var(--muted)" }}>{clientId}</div>
        <div style={{ display: "flex", gap: 4 }}>
          <button type="button" className="btn btn-sm" onClick={() => setPanelHidden(true)} title="Hide this panel (keeps the client selected)">✕</button>
          <button type="button" className="btn btn-sm" onClick={() => setSelectedClient(null)} title="Clear the selected client">Clear</button>
        </div>
      </div>

      {!client && <div className="spinner-wrap" style={{ padding: 24 }}>Loading…</div>}

      {client && (
        <>
          <h2 style={{ fontSize: 17, margin: "0 0 12px" }}>
            <button type="button" onClick={() => navigate(`/clients/${client.client_id}`)} className="client-panel-name-link">{client.client_name}</button>
          </h2>

          <div className="client-panel-section">
            <div className="small-label">Contact</div>
            <ClientRow label="Email" value={client.email} href={client.email ? `mailto:${client.email}` : undefined} />
            <ClientRow label="Phone" value={client.phone} href={client.phone ? `tel:${String(client.phone).replace(/[^\d+]/g, "")}` : undefined} />
          </div>

          <div className="client-panel-section">
            <div className="small-label">Compliance</div>
            <ClientRow label="Sales Tax" value={client.sales_tax_frequency as string | null} />
            <ClientRow label="Service" value={client.service_type} />
          </div>

          <div style={{ margin: "10px 0" }}>
            <StatusBadge status={client.status} />
          </div>

          {summary && (
            <div className="client-panel-section">
              <div className="small-label">Account</div>
              <ClientRow label="Open Tasks" value={String(summary.openTasks)} onClick={() => navigate(`/tasks?clientId=${client.client_id}`)} />
              {summary.taskStatusBreakdown.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "2px 0 8px" }}>
                  {summary.taskStatusBreakdown.map((s) => (
                    <button
                      key={s.status}
                      type="button"
                      className="client-panel-value-link"
                      style={{ fontSize: 11 }}
                      onClick={() => navigate(`/tasks?clientId=${client.client_id}&status=${encodeURIComponent(s.status)}`)}
                    >
                      {s.count} {s.status}
                    </button>
                  ))}
                </div>
              )}
              <ClientRow label="Requests" value={String(summary.openRequests)} onClick={() => navigate(`/documents?clientId=${client.client_id}`)} />
              {/* Documents/Employees were already computed server-side but never
                  shown — "do we have their paperwork" is one of the first things
                  staff check, so it belongs here rather than a page away. */}
              <ClientRow label="Documents" value={String(summary.documentsCount)} onClick={() => navigate(`/documents?clientId=${client.client_id}`)} />
              <ClientRow label="Employees" value={String(summary.employeesCount)} onClick={() => navigate(`/accounting?clientId=${client.client_id}`)} />
              <ClientRow label="Invoices" value={String(summary.openInvoices)} onClick={() => navigate(`/billing?clientId=${client.client_id}`)} />
              <ClientRow label="Balance" value={fmtMoney(summary.balanceDue)} onClick={() => navigate(`/billing?clientId=${client.client_id}`)} />
            </div>
          )}

          <div className="client-panel-section">
            <div className="small-label">Open</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              <button type="button" className="btn btn-sm" onClick={() => navigate(`/documents?clientId=${client.client_id}`)}>Documents</button>
              <button type="button" className="btn btn-sm" onClick={() => navigate(`/tasks?clientId=${client.client_id}`)}>Tasks</button>
              <button type="button" className="btn btn-sm" onClick={() => navigate(`/accounting?clientId=${client.client_id}`)}>Accounting</button>
              <button type="button" className="btn btn-sm" onClick={() => navigate(`/reports?clientId=${client.client_id}`)}>Reports</button>
            </div>
          </div>

          <div className="client-panel-section" style={{ borderBottom: "none" }}>
            <div className="muted" style={{ fontSize: 11 }}>
              {client.updated_at ? `Last updated ${new Date(client.updated_at).toLocaleDateString()}` : "Not yet updated"}
              {client.updated_by && ` by ${client.updated_by}`}
            </div>
          </div>

          <div style={{ marginTop: 14 }}>
            <button type="button" className="btn btn-sm" style={{ width: "100%" }} onClick={() => navigate(`/billing?clientId=${client.client_id}`)}>View Billing</button>
          </div>
        </>
      )}
    </aside>
  );
}

function ClientRow({ label, value, onClick, href }: { label: string; value: string | null | undefined; onClick?: () => void; href?: string }) {
  const display = value || "—";
  const clickable = Boolean((onClick || href) && value);
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 12.5 }}>
      <span className="muted">{label}</span>
      {clickable && href ? (
        <a href={href} className="client-panel-value-link">{display}</a>
      ) : clickable && onClick ? (
        <button type="button" onClick={onClick} className="client-panel-value-link">{display}</button>
      ) : (
        <span>{display}</span>
      )}
    </div>
  );
}
