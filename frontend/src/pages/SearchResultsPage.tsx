import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../api/client";
import { useSelectedClient } from "../context/SelectedClientContext";

interface ClientHit { client_id: string; client_name: string; email: string | null; phone: string | null; status: string | null }
interface TaskHit { task_id: string; task_name: string; client_id: string; client_name: string; status: string; agency_due_date: string | null }
interface InvoiceHit { invoice_id: string; client_id: string; description: string | null; total_amount: number; status: string }
interface DocumentHit { request_id: string; client_id: string; client_name: string; requested_item: string; status: string }

interface SearchResults { clients: ClientHit[]; tasks: TaskHit[]; invoices: InvoiceHit[]; documents: DocumentHit[] }

function fmtMoney(v: unknown): string {
  const n = Number(v);
  return Number.isFinite(n) ? `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—";
}

export function SearchResultsPage() {
  const [searchParams] = useSearchParams();
  const q = searchParams.get("q") || "";
  const navigate = useNavigate();
  const { setSelectedClient } = useSelectedClient();
  const [results, setResults] = useState<SearchResults | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (q.trim().length < 2) {
      setResults({ clients: [], tasks: [], invoices: [], documents: [] });
      return;
    }
    setResults(null);
    api.get<SearchResults>(`/search?q=${encodeURIComponent(q)}`)
      .then(setResults)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Search failed."));
  }, [q]);

  const totalHits = results ? results.clients.length + results.tasks.length + results.invoices.length + results.documents.length : 0;

  return (
    <div>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Search Results</h1>
      <p className="muted" style={{ marginBottom: 20 }}>{q ? `Results for "${q}"` : "Enter a search term above."}</p>

      {error && <div className="error-banner">{error}</div>}
      {!results && !error && <div className="spinner-wrap">Searching…</div>}
      {results && q.trim().length >= 2 && totalHits === 0 && <p className="muted">No matches across clients, tasks, invoices, or document requests.</p>}

      {results && results.clients.length > 0 && (
        <div className="card" style={{ marginBottom: 16, padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "10px 16px", fontWeight: 700, borderBottom: "1px solid var(--line)" }}>Clients</div>
          <div className="table-scroll">
          <table>
            <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Status</th></tr></thead>
            <tbody>
              {results.clients.map((c) => (
                <tr key={c.client_id} style={{ cursor: "pointer" }} onClick={() => { setSelectedClient(c.client_id, c.client_name); navigate(`/clients/${c.client_id}`); }}>
                  <td>{c.client_name}</td>
                  <td className="muted">{c.email || "—"}</td>
                  <td className="muted">{c.phone || "—"}</td>
                  <td className="muted">{c.status || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {results && results.tasks.length > 0 && (
        <div className="card" style={{ marginBottom: 16, padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "10px 16px", fontWeight: 700, borderBottom: "1px solid var(--line)" }}>Tasks</div>
          <div className="table-scroll">
          <table>
            <thead><tr><th>Task</th><th>Client</th><th>Status</th><th>Due Date</th></tr></thead>
            <tbody>
              {results.tasks.map((t) => (
                <tr key={t.task_id} style={{ cursor: "pointer" }} onClick={() => { setSelectedClient(t.client_id, t.client_name); navigate(`/tasks/${t.task_id}`); }}>
                  <td>{t.task_name}</td>
                  <td className="muted">{t.client_name}</td>
                  <td className="muted">{t.status}</td>
                  <td className="muted">{t.agency_due_date ? new Date(t.agency_due_date).toLocaleDateString() : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {results && results.invoices.length > 0 && (
        <div className="card" style={{ marginBottom: 16, padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "10px 16px", fontWeight: 700, borderBottom: "1px solid var(--line)" }}>Invoices</div>
          <div className="table-scroll">
          <table>
            <thead><tr><th>Invoice</th><th>Description</th><th>Amount</th><th>Status</th></tr></thead>
            <tbody>
              {results.invoices.map((i) => (
                <tr key={i.invoice_id} style={{ cursor: "pointer" }} onClick={() => navigate(`/billing/${i.invoice_id}`)}>
                  <td>{i.invoice_id}</td>
                  <td className="muted">{i.description || "—"}</td>
                  <td>{fmtMoney(i.total_amount)}</td>
                  <td className="muted">{i.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {results && results.documents.length > 0 && (
        <div className="card" style={{ marginBottom: 16, padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "10px 16px", fontWeight: 700, borderBottom: "1px solid var(--line)" }}>Document Requests</div>
          <div className="table-scroll">
          <table>
            <thead><tr><th>Item</th><th>Client</th><th>Status</th></tr></thead>
            <tbody>
              {results.documents.map((d) => (
                <tr key={d.request_id} style={{ cursor: "pointer" }} onClick={() => navigate(`/documents/${d.request_id}`)}>
                  <td>{d.requested_item}</td>
                  <td className="muted">{d.client_name}</td>
                  <td className="muted">{d.status}</td>
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
