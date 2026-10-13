import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { FileUp, PenLine } from "lucide-react";
import { api, ApiError, viewFile } from "../api/client";
import type { Client } from "../api/types";
import { DocSigningPanel } from "../components/DocSigningPanel";
import { FileDropInput } from "../components/FileDropInput";
import { useToast } from "../components/Toast";
import { fileToBase64 } from "../utils/file";

interface Row { docId: string; title: string; uploaded: boolean; clientId: string; clientName: string | null; status: string; createdAt: string; sentAt: string | null; signedAt: string | null; createdBy: string; total: number; signed: number; declined: number }
type Filter = "all" | "waiting" | "completed" | "draft";

const FILTERS: [Filter, string][] = [["all", "All"], ["waiting", "Waiting for signatures"], ["completed", "Completed"], ["draft", "Not sent yet"]];
const statusLabel = (r: Row) => (r.status === "Signed" ? "Completed" : r.status === "Sent" ? (r.declined ? "Declined" : "Waiting") : "Not sent");
const statusColor = (r: Row) => (r.status === "Signed" ? "var(--green, #1a7f4b)" : r.declined ? "var(--red, #b3261e)" : r.status === "Sent" ? "var(--teal, #0f766e)" : "var(--muted, #666)");

/** The E-Sign tab: upload a PDF (or pick one already built) and take it through signing — sign it yourself, send it to the parties, follow who has signed. */
export function ESignPage() {
  const toast = useToast();
  const [clients, setClients] = useState<Client[]>([]);
  const [clientId, setClientId] = useState("");
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = (f: Filter = filter) => api.get<{ docs: Row[] }>(`/doc-builder/esign/list?status=${f}`).then((r) => setRows(r.docs)).catch(() => setRows([]));
  useEffect(() => { api.get<{ clients: Client[] }>("/clients").then((r) => setClients(r.clients)).catch(() => {}); }, []);
  useEffect(() => { setRows(null); load(filter); }, [filter]); // eslint-disable-line react-hooks/exhaustive-deps

  async function upload() {
    if (!file || !clientId) return;
    setBusy(true); setError(null);
    try {
      const fileBase64 = await fileToBase64(file);
      const r = await api.post<{ docId: string; pages: number }>("/doc-builder/esign/upload", { clientId, title: title.trim() || undefined, fileName: file.name, fileBase64 });
      toast(`Uploaded (${r.pages} page${r.pages === 1 ? "" : "s"}). Now choose who signs.`);
      setFile(null); setTitle(""); setOpen(r.docId); load(); window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) { setError(e instanceof ApiError ? e.message : "Could not upload this file."); } finally { setBusy(false); }
  }

  return (
    <div style={{ padding: 20, display: "grid", gap: 16 }}>
      {open && <DocSigningPanel docId={open} onChanged={() => load()} onClose={() => setOpen(null)} />}

      <div className="command-panel">
        <div className="command-panel-header"><div><h2 className="command-panel-title" style={{ display: "flex", gap: 8, alignItems: "center" }}><FileUp size={17} aria-hidden="true" /> Send a document for signature</h2>
          <div className="command-panel-note">Upload a PDF, add the people who need to sign (you can add yourself and sign right away), and send each their own link.</div></div></div>
        <div style={{ padding: 16, display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", alignItems: "start" }}>
          <div className="field" style={{ margin: 0 }}><label htmlFor="es-client">Client<span style={{ color: "var(--red)" }}> *</span></label>
            <select id="es-client" value={clientId} onChange={(e) => setClientId(e.target.value)}><option value="">Select a client…</option>{clients.map((c) => <option key={c.client_id} value={c.client_id}>{c.client_name}</option>)}</select></div>
          <div className="field" style={{ margin: 0 }}><label htmlFor="es-title">Document name <span className="muted">(optional)</span></label><input id="es-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Defaults to the file name" /></div>
          <div style={{ gridColumn: "1 / -1" }}><FileDropInput file={file} onChange={setFile} accept="application/pdf,.pdf" hint="PDF only, up to 8 MB. For a Word document, save it as PDF first." /></div>
          {error && <div className="tender-warn" style={{ gridColumn: "1 / -1", color: "var(--red)" }}>{error}</div>}
          <div style={{ gridColumn: "1 / -1" }}><button type="button" className="btn btn-primary" disabled={busy || !file || !clientId} onClick={upload}>{busy ? "Uploading…" : "Upload & choose signers"}</button>
            <span className="muted" style={{ fontSize: 12, marginLeft: 10 }}>Documents made in the <Link to="/document-builder">Document Builder</Link> appear below too.</span></div>
        </div>
      </div>

      <div className="command-panel">
        <div className="command-panel-header"><h2 className="command-panel-title" style={{ display: "flex", gap: 8, alignItems: "center" }}><PenLine size={17} aria-hidden="true" /> Documents</h2></div>
        <div style={{ padding: "10px 16px", display: "flex", gap: 6, flexWrap: "wrap", borderBottom: "1px solid var(--line)" }}>
          {FILTERS.map(([k, label]) => <button key={k} type="button" className={`tpl-chip${filter === k ? " on" : ""}`} onClick={() => setFilter(k)}>{label}</button>)}
        </div>
        {!rows && <div className="spinner-wrap">Loading…</div>}
        {rows && rows.length === 0 && <p className="muted" style={{ padding: 16, margin: 0 }}>Nothing here yet. Upload a PDF above, or build a document in the Document Builder.</p>}
        {rows && rows.length > 0 && (
          <div className="table-scroll"><table>
            <thead><tr><th scope="col">Document</th><th scope="col">Client</th><th scope="col">Signatures</th><th scope="col">Status</th><th scope="col">Updated</th><th scope="col"></th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.docId}>
                <td><b>{r.title}</b><div className="muted" style={{ fontSize: 12 }}>{r.uploaded ? "Uploaded PDF" : "Built in Document Builder"} · {r.createdBy}</div></td>
                <td>{r.clientName || r.clientId}</td>
                <td>{r.total ? `${r.signed} of ${r.total} signed` : "—"}</td>
                <td style={{ color: statusColor(r), fontWeight: 700 }}>{statusLabel(r)}</td>
                <td className="muted">{new Date(r.signedAt || r.sentAt || r.createdAt).toLocaleDateString()}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <button type="button" className="btn btn-sm" onClick={() => { setOpen(r.docId); window.scrollTo({ top: 0, behavior: "smooth" }); }}>{r.status === "Draft" ? "Add signers" : "Open"}</button>{" "}
                  {r.status === "Signed" && <button type="button" className="btn btn-sm" onClick={() => viewFile(`/doc-builder/docs/${r.docId}/signed-pdf`)}>Signed copy</button>}
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
    </div>
  );
}
