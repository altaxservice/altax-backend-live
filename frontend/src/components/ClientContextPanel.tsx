import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { Client } from "../api/types";
import { StatusBadge } from "./StatusBadge";
import { useSelectedClient } from "../context/SelectedClientContext";

interface Summary {
  openTasks: number;
  openRequests: number;
  openInvoices: number;
  balanceDue: number;
}

function fmtMoney(v: unknown): string {
  const n = Number(v);
  return Number.isFinite(n) ? `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "$0.00";
}

export function ClientContextPanel() {
  const { clientId, setSelectedClient } = useSelectedClient();
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

  return (
    <aside className="client-panel">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
        <div className="small-label" style={{ color: "var(--muted)" }}>{clientId}</div>
        <button type="button" className="btn btn-sm" onClick={() => setSelectedClient(null)} title="Clear selected client">✕</button>
      </div>

      {!client && <div className="spinner-wrap" style={{ padding: 24 }}>Loading…</div>}

      {client && (
        <>
          <h2 style={{ fontSize: 17, margin: "0 0 12px" }}>{client.client_name}</h2>

          <div className="client-panel-section">
            <div className="small-label">Contact</div>
            <ClientRow label="Email" value={client.email} />
            <ClientRow label="Phone" value={client.phone} />
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
              <ClientRow label="Open Tasks" value={String(summary.openTasks)} />
              <ClientRow label="Requests" value={String(summary.openRequests)} />
              <ClientRow label="Invoices" value={String(summary.openInvoices)} />
              <ClientRow label="Balance" value={fmtMoney(summary.balanceDue)} />
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 14 }}>
            <button type="button" className="btn btn-sm" onClick={() => navigate(`/clients/${client.client_id}`)}>Open Client Profile</button>
            <button type="button" className="btn btn-sm" onClick={() => navigate(`/billing?clientId=${client.client_id}`)}>View Billing</button>
          </div>
        </>
      )}
    </aside>
  );
}

function ClientRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 12.5 }}>
      <span className="muted">{label}</span>
      <span>{value || "—"}</span>
    </div>
  );
}
