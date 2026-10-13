import { useEffect, useState } from "react";
import { Check, Copy, Send } from "lucide-react";
import { api, ApiError, viewFile } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useConfirm, useNotify } from "./ConfirmProvider";
import { useToast } from "./Toast";
import { printText } from "../utils/printDocument";

interface Signer { signerId: string; role: string; name: string; email: string | null; phone: string | null; delivery: string; status: string; sentAt: string | null; viewedAt: string | null; signedAt: string | null; declinedAt: string | null; declineReason: string | null; reminders: number; link: string | null }
interface Info {
  doc: { docId: string; title: string; clientName: string; contractId: string; status: string; lang: string; body: string };
  signers: Signer[]; suggestions: { role: string; name: string }[]; needsNotary: boolean; locked: boolean;
}
interface Row { role: string; name: string; email: string; phone: string; delivery: "email" | "sms" | "both" | "link" }

const fmt = (v: string | null) => (v ? new Date(v).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "");
const TONE: Record<string, string> = { Signed: "var(--green, #1a7f4b)", Declined: "var(--red, #b3261e)", Cancelled: "var(--muted, #888)", Viewed: "var(--teal, #0f766e)", Sent: "var(--muted, #666)", Pending: "var(--muted, #888)" };

/** Send a built document for e-signature to one or several people, follow who has signed, remind, cancel, and get the signed copy. */
export function DocSigningPanel({ docId, onChanged, onClose }: { docId: string; onChanged?: () => void; onClose?: () => void }) {
  const { user } = useAuth();
  const toast = useToast();
  const notify = useNotify();
  const confirmDialog = useConfirm();
  const [info, setInfo] = useState<Info | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    api.get<Info>(`/doc-builder/docs/${docId}/signing`).then((r) => {
      setInfo(r);
      if (!r.signers.length) setRows(r.suggestions.map((s) => ({ role: s.role, name: s.name, email: /^firm/i.test(s.role) ? user?.email || "" : "", phone: "", delivery: "email" })));
      else setRows(r.signers.map((s) => ({ role: s.role, name: s.name, email: s.email || "", phone: s.phone || "", delivery: (s.delivery as Row["delivery"]) || "email" })));
    }).catch((e) => setError(e instanceof ApiError ? e.message : "Could not load the signing details."));
  }
  useEffect(load, [docId]); // eslint-disable-line react-hooks/exhaustive-deps
  const setRow = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  /** signNow = index of the person who signs right now on this device: their link isn't messaged, it opens straight away. */
  async function send(signNow?: number) {
    // Open the tab inside the click so the browser doesn't block it; it is pointed at the signing page once the link exists.
    const tab = signNow !== undefined ? window.open("", "_blank") : null;
    setBusy(true); setError(null);
    try {
      const list = rows.map((r, i) => (i === signNow ? { ...r, delivery: "link" as const } : r));
      const r = await api.post<{ results: { signerId: string; emailed: boolean; texted: boolean; error: string | null }[] }>(`/doc-builder/docs/${docId}/signing/send`, { signers: list });
      const failed = r.results.filter((x) => x.error);
      const fresh = await api.get<Info>(`/doc-builder/docs/${docId}/signing`);
      if (tab && signNow !== undefined) { const link = fresh.signers[signNow]?.link; if (link) tab.location.href = link; else tab.close(); }
      toast(signNow !== undefined ? "Opened the signing page." : failed.length ? `Sent, but ${failed.length} message(s) could not be delivered — copy their links below.` : "Sent for signature.");
      load(); onChanged?.();
    } catch (e) { tab?.close(); setError(e instanceof ApiError ? e.message : "Could not send for signature."); } finally { setBusy(false); }
  }
  const addMyself = () => setRows((rs) => [...rs, { role: "Firm representative", name: user?.name || "", email: user?.email || "", phone: "", delivery: "link" }]);
  async function remind(signerId?: string) {
    setBusy(true);
    try { const r = await api.post<{ reminded: number; skipped: string[] }>(`/doc-builder/docs/${docId}/signing/remind`, { signerId }); toast(r.reminded ? `Reminder sent to ${r.reminded}.` : "Nobody to remind (a reminder was already sent in the last hour, or the link was shared by hand)."); load(); }
    catch (e) { await notify(e instanceof ApiError ? e.message : "Could not send the reminder."); } finally { setBusy(false); }
  }
  async function cancel() {
    if (!(await confirmDialog({ title: "Cancel this signing request?", message: "The signing links stop working and the document goes back to a draft. Anyone who already signed keeps their signature on record.", confirmLabel: "Cancel request", danger: true }))) return;
    setBusy(true);
    try { await api.post(`/doc-builder/docs/${docId}/signing/cancel`, {}); load(); onChanged?.(); } catch (e) { await notify(e instanceof ApiError ? e.message : "Could not cancel."); } finally { setBusy(false); }
  }
  const copy = (link: string) => navigator.clipboard?.writeText(link).then(() => toast("Link copied."), () => toast("Could not copy."));

  if (error && !info) return <div className="tender-warn">{error}</div>;
  if (!info) return <div className="spinner-wrap">Loading…</div>;
  const sent = info.signers.length > 0;
  const done = info.doc.status === "Signed";
  const waiting = info.signers.filter((s) => s.status === "Sent" || s.status === "Viewed");

  return (
    <div className="command-panel">
      <div className="command-panel-header">
        <div><h3 className="command-panel-title" style={{ display: "flex", gap: 8, alignItems: "center" }}><Send size={16} aria-hidden="true" /> E-signature — {info.doc.title}</h3>
          <div className="command-panel-note">{done ? "Everyone has signed." : sent ? `${info.signers.filter((s) => s.status === "Signed").length} of ${info.signers.filter((s) => s.status !== "Cancelled").length} signed` : "Choose who signs and how they get their link."}</div></div>
        {onClose && <button type="button" className="btn btn-sm" onClick={onClose}>Close</button>}
      </div>
      <div style={{ padding: 16, display: "grid", gap: 12 }}>
        {info.needsNotary && <div className="tender-warn">This document also needs a notary's signature and seal. An electronic signature does not replace that — print it and have it notarized if the destination requires it.</div>}
        {error && <div className="tender-warn" style={{ color: "var(--red)" }}>{error}</div>}

        {(!sent || !info.locked) && !done && (
          <div style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <b style={{ fontSize: 13 }}>Who needs to sign?</b>
              <button type="button" className="btn btn-sm" onClick={addMyself}>+ Add myself</button>
              <button type="button" className="btn btn-sm" onClick={() => setRows([...rows, { role: "Signer", name: "", email: "", phone: "", delivery: "email" }])}>+ Add another person</button>
              <span className="muted" style={{ fontSize: 12 }}>To sign yourself right now, add yourself and press <b>Sign now</b>.</span>
            </div>
            {rows.map((r, i) => (
              <div key={i} className="card" style={{ padding: "10px 12px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8, alignItems: "end" }}>
                <div className="field" style={{ margin: 0 }}><label>Role</label><input value={r.role} onChange={(e) => setRow(i, { role: e.target.value })} /></div>
                <div className="field" style={{ margin: 0 }}><label>Name</label><input value={r.name} onChange={(e) => setRow(i, { name: e.target.value })} /></div>
                <div className="field" style={{ margin: 0 }}><label>Email</label><input type="email" value={r.email} onChange={(e) => setRow(i, { email: e.target.value })} /></div>
                <div className="field" style={{ margin: 0 }}><label>Mobile</label><input type="tel" value={r.phone} onChange={(e) => setRow(i, { phone: e.target.value })} /></div>
                <div className="field" style={{ margin: 0 }}><label>Send link by</label>
                  <select value={r.delivery} onChange={(e) => setRow(i, { delivery: e.target.value as Row["delivery"] })}>
                    <option value="email">Email</option><option value="sms">Text message</option><option value="both">Email + text</option><option value="link">Don't send — I'll share the link</option>
                  </select></div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <button type="button" className="btn btn-sm btn-primary" disabled={busy || !r.name.trim()} onClick={() => send(i)} title="Sign this one now on this device — the others still get their links">Sign now</button>
                  <button type="button" className="btn btn-sm" onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove</button>
                </div>
              </div>
            ))}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" className="btn btn-primary" disabled={busy || rows.length === 0} onClick={() => send()}><Send size={14} aria-hidden="true" /> {sent ? "Save & send again" : "Send for signature"}</button>
            </div>
            <div className="muted" style={{ fontSize: 12 }}>Everyone gets their own private link and can read the whole document before signing. Text messages go only to the numbers you enter here.</div>
          </div>
        )}

        {sent && (
          <div className="table-scroll"><table>
            <thead><tr><th scope="col">Signer</th><th scope="col">Status</th><th scope="col"></th></tr></thead>
            <tbody>{info.signers.map((s) => (
              <tr key={s.signerId}>
                <td><b>{s.name}</b><div className="muted" style={{ fontSize: 12 }}>{s.role}{s.email ? ` · ${s.email}` : ""}{s.phone ? ` · ${s.phone}` : ""}</div></td>
                <td style={{ color: TONE[s.status] }}><b>{s.status === "Signed" ? <><Check size={13} aria-hidden="true" /> Signed</> : s.status === "Viewed" ? "Opened" : s.status === "Sent" ? "Sent" : s.status}</b>
                  <div className="muted" style={{ fontSize: 12 }}>{s.signedAt ? fmt(s.signedAt) : s.declinedAt ? `${fmt(s.declinedAt)}${s.declineReason ? ` — ${s.declineReason}` : ""}` : s.viewedAt ? `Opened ${fmt(s.viewedAt)}` : s.sentAt ? `Sent ${fmt(s.sentAt)}` : ""}{s.reminders ? ` · ${s.reminders} reminder${s.reminders === 1 ? "" : "s"}` : ""}</div></td>
                <td style={{ whiteSpace: "nowrap" }}>
                  {s.link && s.status !== "Cancelled" && <><button type="button" className="btn btn-sm" onClick={() => copy(s.link!)}><Copy size={12} aria-hidden="true" /> Copy link</button>{" "}
                    <a className="btn btn-sm" href={s.link} target="_blank" rel="noreferrer">Sign on this device</a>{" "}</>}
                  {(s.status === "Sent" || s.status === "Viewed") && <button type="button" className="btn btn-sm" disabled={busy} onClick={() => remind(s.signerId)}>Remind</button>}
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        )}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {waiting.length > 1 && <button type="button" className="btn btn-sm" disabled={busy} onClick={() => remind()}>Remind everyone waiting</button>}
          {sent && !done && <button type="button" className="btn btn-sm btn-danger" disabled={busy} onClick={cancel}>Cancel signing request</button>}
          {sent && <button type="button" className="btn btn-sm" onClick={() => viewFile(`/doc-builder/docs/${docId}/signed-pdf`)}>{done ? "Signed copy (PDF)" : "Current copy (PDF)"}</button>}
          {sent && info.doc.lang !== "en" && <button type="button" className="btn btn-sm" onClick={() => printText(info.doc.title, info.doc.body)}>Print / Save as PDF (Arabic text)</button>}
        </div>
        {info.doc.lang !== "en" && <div className="muted" style={{ fontSize: 12 }}>For Arabic and bilingual documents, the PDF above shows the signatures but leaves out the Arabic paragraphs — signers read the full Arabic text on their signing page, and "Print / Save as PDF" prints it.</div>}
      </div>
    </div>
  );
}
