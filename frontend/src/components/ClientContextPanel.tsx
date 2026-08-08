import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../api/client";
import type { Client } from "../api/types";
import { StatusBadge } from "./StatusBadge";
import { useSelectedClient } from "../context/SelectedClientContext";
import { useToast } from "./Toast";
import { useNotify } from "./ConfirmProvider";

interface Summary {
  openTasks: number;
  taskStatusBreakdown: { status: string; count: number }[];
  openRequests: number;
  openInvoices: number;
  balanceDue: number;
  employeesCount: number;
  documentsCount: number;
}

interface ClientFlag {
  flagId: string | null;
  flagType: "BalancePastDue" | "Credit" | "Custom";
  amount: number | null;
  note: string | null;
  color: "red" | "green" | "amber";
  createdAt: string | null;
  createdBy: string | null;
  resolvable: boolean;
}

function fmtMoney(v: unknown): string {
  const n = Number(v);
  return Number.isFinite(n) ? `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "$0.00";
}

function flagLabel(f: ClientFlag): string {
  if (f.flagType === "BalancePastDue") return `Balance Past Due: ${fmtMoney(f.amount)}`;
  if (f.flagType === "Credit") return `Credit: ${fmtMoney(f.amount)}${f.note ? ` — ${f.note}` : ""}`;
  return `${f.note}${f.amount !== null ? ` (${fmtMoney(f.amount)})` : ""}`;
}

export function ClientContextPanel() {
  const { clientId, clientName, setSelectedClient, panelHidden, setPanelHidden } = useSelectedClient();
  const navigate = useNavigate();
  const toast = useToast();
  const notify = useNotify();
  const [client, setClient] = useState<Client | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [flags, setFlags] = useState<ClientFlag[] | null>(null);
  const [showAddFlag, setShowAddFlag] = useState(false);
  const [flagType, setFlagType] = useState<"Credit" | "Custom">("Custom");
  const [flagAmount, setFlagAmount] = useState("");
  const [flagNote, setFlagNote] = useState("");
  const [savingFlag, setSavingFlag] = useState(false);
  const [flagError, setFlagError] = useState<string | null>(null);

  function loadFlags(id: string) {
    api.get<{ flags: ClientFlag[] }>(`/clients/${id}/flags`).then((res) => setFlags(res.flags)).catch(() => setFlags([]));
  }

  useEffect(() => {
    if (!clientId) {
      setClient(null);
      setSummary(null);
      setFlags(null);
      return;
    }
    let cancelled = false;
    api.get<{ client: Client }>(`/clients/${clientId}`).then((res) => { if (!cancelled) setClient(res.client); }).catch(() => { if (!cancelled) setClient(null); });
    api.get<Summary>(`/clients/${clientId}/summary`).then((res) => { if (!cancelled) setSummary(res); }).catch(() => { if (!cancelled) setSummary(null); });
    loadFlags(clientId);
    return () => { cancelled = true; };
  }, [clientId]);

  async function handleAddFlag(e: FormEvent) {
    e.preventDefault();
    if (!clientId) return;
    setFlagError(null);
    if (flagType === "Credit") {
      const n = Number(flagAmount);
      if (!Number.isFinite(n) || n <= 0) { setFlagError("Enter the credit amount."); return; }
    } else if (!flagNote.trim()) {
      setFlagError("Describe what this flag is.");
      return;
    }
    setSavingFlag(true);
    try {
      await api.post(`/clients/${clientId}/flags`, { flagType, amount: flagAmount ? Number(flagAmount) : undefined, note: flagNote.trim() || undefined });
      setShowAddFlag(false);
      setFlagAmount("");
      setFlagNote("");
      setFlagType("Custom");
      loadFlags(clientId);
      toast("Flag added.");
    } catch (err) {
      setFlagError(err instanceof ApiError ? err.message : "Could not add this flag.");
    } finally {
      setSavingFlag(false);
    }
  }

  async function handleResolveFlag(flagId: string) {
    if (!clientId) return;
    try {
      await api.post(`/clients/${clientId}/flags/${flagId}/resolve`, {});
      loadFlags(clientId);
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not resolve this flag.");
    }
  }

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

  const hasBalancePastDue = (flags || []).some((f) => f.flagType === "BalancePastDue");

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
          <h2 style={{ fontSize: 17, margin: "0 0 8px" }}>
            <button type="button" onClick={() => navigate(`/clients/${client.client_id}`)} className="client-panel-name-link">{client.client_name}</button>
          </h2>

          {/* Noticeable, colored account issues — separate from the freeform
              Activity Timeline because a note's "read" state says nothing
              about whether the underlying problem is actually fixed. Balance
              Past Due is computed live from real invoices and self-clears the
              moment it's paid; Credit/Custom are staff-entered and stay until
              explicitly resolved. */}
          {flags && flags.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
              {flags.map((f) => (
                <div
                  key={f.flagId || f.flagType}
                  className={`status-pill status-${f.color}`}
                  style={{ justifyContent: "space-between", width: "100%", padding: "6px 10px", fontSize: 12 }}
                >
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{flagLabel(f)}</span>
                  {f.resolvable && f.flagId && (
                    <button
                      type="button"
                      onClick={() => handleResolveFlag(f.flagId!)}
                      title="Resolve this flag"
                      aria-label="Resolve this flag"
                      style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", fontWeight: 800, padding: 0, marginLeft: 6, flex: "0 0 auto" }}
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {!showAddFlag ? (
            <button type="button" className="btn btn-sm" style={{ marginBottom: 12 }} onClick={() => { setShowAddFlag(true); setFlagError(null); }}>+ Flag</button>
          ) : (
            <form onSubmit={handleAddFlag} style={{ marginBottom: 12, border: "1px solid var(--line)", borderRadius: 8, padding: 10, display: "grid", gap: 6 }}>
              {flagError && <div className="error-banner" role="alert" style={{ fontSize: 11.5, padding: "6px 8px" }}>{flagError}</div>}
              <select value={flagType} onChange={(e) => setFlagType(e.target.value as "Credit" | "Custom")} style={{ fontSize: 12.5 }}>
                <option value="Custom">Something else…</option>
                <option value="Credit">Credit on account</option>
              </select>
              {flagType === "Credit" && (
                <input type="number" step="0.01" min="0" placeholder="Credit amount" value={flagAmount} onChange={(e) => setFlagAmount(e.target.value)} style={{ fontSize: 12.5 }} />
              )}
              <input
                type="text"
                placeholder={flagType === "Credit" ? "Note (optional)" : "What is it?"}
                value={flagNote}
                onChange={(e) => setFlagNote(e.target.value)}
                style={{ fontSize: 12.5 }}
              />
              {flagType === "Custom" && (
                <input type="number" step="0.01" placeholder="Amount (optional)" value={flagAmount} onChange={(e) => setFlagAmount(e.target.value)} style={{ fontSize: 12.5 }} />
              )}
              <div style={{ display: "flex", gap: 6 }}>
                <button type="submit" className="btn btn-primary btn-sm" disabled={savingFlag}>{savingFlag ? "Saving…" : "Save Flag"}</button>
                <button type="button" className="btn btn-sm" onClick={() => { setShowAddFlag(false); setFlagError(null); setFlagAmount(""); setFlagNote(""); }}>Cancel</button>
              </div>
            </form>
          )}

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
              <ClientRow label="Requests" value={String(summary.openRequests)} onClick={() => navigate(`/clients/${client.client_id}?tab=Documents`)} />
              {/* Documents/Employees were already computed server-side but never
                  shown — "do we have their paperwork" is one of the first things
                  staff check, so it belongs here rather than a page away. */}
              <ClientRow label="Documents" value={String(summary.documentsCount)} onClick={() => navigate(`/clients/${client.client_id}?tab=Documents`)} />
              <ClientRow label="Employees" value={String(summary.employeesCount)} onClick={() => navigate(`/accounting?clientId=${client.client_id}`)} />
              <ClientRow label="Invoices" value={String(summary.openInvoices)} onClick={() => navigate(`/billing?clientId=${client.client_id}`)} />
              <ClientRow
                label="Balance"
                value={fmtMoney(summary.balanceDue)}
                onClick={() => navigate(`/billing?clientId=${client.client_id}`)}
                valueColor={hasBalancePastDue ? "var(--red)" : undefined}
              />
            </div>
          )}

          <div className="client-panel-section">
            <div className="small-label">Open</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              <button type="button" className="btn btn-sm" onClick={() => navigate(`/clients/${client.client_id}?tab=Documents`)}>Documents</button>
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

function ClientRow({ label, value, onClick, href, valueColor }: { label: string; value: string | null | undefined; onClick?: () => void; href?: string; valueColor?: string }) {
  const display = value || "—";
  const clickable = Boolean((onClick || href) && value);
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 12.5 }}>
      <span className="muted">{label}</span>
      {clickable && href ? (
        <a href={href} className="client-panel-value-link" style={valueColor ? { color: valueColor } : undefined}>{display}</a>
      ) : clickable && onClick ? (
        <button type="button" onClick={onClick} className="client-panel-value-link" style={valueColor ? { color: valueColor, fontWeight: 800 } : undefined}>{display}</button>
      ) : (
        <span style={valueColor ? { color: valueColor, fontWeight: 800 } : undefined}>{display}</span>
      )}
    </div>
  );
}
