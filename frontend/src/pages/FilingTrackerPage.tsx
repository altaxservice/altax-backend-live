import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../api/client";
import { ErrorBanner } from "../components/ErrorBanner";
import { useConfirm, useNotify } from "../components/ConfirmProvider";
import { useToast } from "../components/Toast";
import { RowNote, useRowNotes, type RowNotesApi } from "../components/RowNote";

export type TrackerKind = "sales" | "withholding" | "eftps" | "form941" | "ui";
export type TrackerStatus = "not_filed" | "unpaid" | "scheduled" | "not_sent" | "done" | "no_data";

export interface TrackerCell {
  kind: TrackerKind; label: string; state: string; periodLabel: string; periodStart: string; periodEnd: string; dueDate: string;
  status: TrackerStatus; filedDate: string | null; paidDate: string | null; sentAt: string | null; acknowledgedAt: string | null;
  overdue: boolean; carried: boolean; canNotify: boolean; recordId: string | null;
}
export interface TrackerRow { clientId: string; clientName: string; state: string; assignedTo: string | null; canNotify: boolean; cells: TrackerCell[] }
interface KindSummary { total: number; done: number; notFiled: number; unpaid: number; notSent: number; overdue: number; noData: number }
export interface TrackerData { month: string; today: string; kinds: TrackerKind[]; summary: Record<TrackerKind, KindSummary>; rows: TrackerRow[] }
interface MessageSample { id: string; title: string; when: string; variants: { label: string; subject: string; html: string; sms: string }[] }

export const KIND_LABEL: Record<TrackerKind, string> = { sales: "Sales Tax", withholding: "Withholding", eftps: "EFTPS", form941: "Form 941", ui: "Unemployment" };
const KIND_ORDER: TrackerKind[] = ["sales", "withholding", "eftps", "form941", "ui"];
const ACCOUNTING_TAB: Record<TrackerKind, string> = { sales: "Sales", withholding: "Withholding", eftps: "EFTPS Deposits", form941: "Form 941", ui: "MD UI" };

const STATUS_TEXT: Record<TrackerStatus, string> = {
  not_filed: "Not filed", unpaid: "Payment missing", scheduled: "Payment scheduled", not_sent: "Not sent to client", done: "Done", no_data: "No payroll data",
};
const STATUS_CLASS: Record<TrackerStatus, string> = {
  not_filed: "status-red", unpaid: "status-amber", scheduled: "status-blue", not_sent: "status-purple", done: "status-green", no_data: "status-gray",
};
type Filter = "attention" | "not_filed" | "unpaid" | "not_sent" | "done" | "all";
const FILTER_LABEL: Record<Filter, string> = { attention: "Needs attention", not_filed: "Not filed", unpaid: "Payment missing", not_sent: "Not sent", done: "Done", all: "Everything" };

const needsAttention = (c: TrackerCell) => c.status === "not_filed" || c.status === "unpaid" || c.status === "not_sent";
function matches(c: TrackerCell, f: Filter): boolean {
  if (f === "all") return true;
  if (f === "attention") return needsAttention(c);
  if (f === "unpaid") return c.status === "unpaid" || c.status === "scheduled";
  return c.status === f;
}

export function monthLabel(m: string): string {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}
function shiftMonth(m: string, delta: number): string {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function fmtDue(v: string): string {
  return new Date(`${v}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
function fmtDay(v: string | null): string {
  return v ? new Date(`${v.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "—";
}

/** Where the Mark Filed screen for this filing lives. */
export function cellLink(clientId: string, c: TrackerCell): string {
  const q = new URLSearchParams({ client: clientId, tab: ACCOUNTING_TAB[c.kind] });
  if (c.kind === "sales") { q.set("from", c.periodStart); q.set("to", c.periodEnd); }
  return `/accounting?${q.toString()}`;
}

/** The sentence under a cell's pill — what exactly is still open. */
function cellDetail(c: TrackerCell): string {
  if (c.status === "no_data") return `${c.periodLabel} · import payroll first`;
  if (c.status === "done") return `${c.periodLabel} · filed ${fmtDay(c.filedDate)}${c.acknowledgedAt ? " · client confirmed" : ""}`;
  if (c.status === "not_filed") return `${c.periodLabel} · ${c.overdue ? "was due" : "due"} ${fmtDue(c.dueDate)}`;
  if (c.status === "unpaid") return `${c.periodLabel} · filed ${fmtDay(c.filedDate)}, due ${fmtDue(c.dueDate)}`;
  if (c.status === "scheduled") return `${c.periodLabel} · pays ${fmtDay(c.paidDate)}`;
  return `${c.periodLabel} · filed and paid`;
}

/** The same row id the client's own filing tables use, so a note written here shows there and the other way round. */
export function filingNoteId(c: TrackerCell): string {
  return c.kind === "withholding" ? `withholding:${c.periodEnd}:${c.state}` : `${c.kind}:${c.periodEnd}`;
}

function Cell({ clientId, cells, notes }: { clientId: string; cells: TrackerCell[]; notes: RowNotesApi }) {
  if (cells.length === 0) return <span className="muted">—</span>;
  return (
    <div style={{ display: "grid", gap: 6 }}>
      {cells.map((c) => (
        <div key={`${c.label}|${c.periodEnd}`} style={{ display: "flex", gap: 4, alignItems: "flex-start", justifyContent: "space-between" }}>
          <Link to={cellLink(clientId, c)} title={`${c.label} · ${c.periodLabel} — open the filing screen`} style={{ display: "grid", gap: 2, textDecoration: "none", color: "inherit" }}>
            <span className={`status-pill ${STATUS_CLASS[c.status]}`} style={{ width: "fit-content" }}>
              {c.status === "done" ? "✓ " : ""}{c.overdue ? "Overdue · " : ""}{STATUS_TEXT[c.status]}{cells.length > 1 || c.state !== "MD" && c.kind === "withholding" ? ` · ${c.state}` : ""}
            </span>
            <span className="muted" style={{ fontSize: 11.5 }}>{c.carried ? `Earlier · ` : ""}{cellDetail(c)}</span>
          </Link>
          <RowNote notes={notes} type="filing" id={filingNoteId(c)} clientId={clientId} label={`${c.label} · ${c.periodLabel}`} />
        </div>
      ))}
    </div>
  );
}

function ProgressBar({ done, total, color = "var(--green)" }: { done: number; total: number; color?: string }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div style={{ height: 6, borderRadius: 999, background: "#e6eaf0", overflow: "hidden" }} aria-hidden="true">
      <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 999, transition: "width .3s" }} />
    </div>
  );
}

/** Per-filing totals used by both the page and the Command Center strip. */
export function trackerTotals(data: TrackerData) {
  let total = 0, done = 0;
  for (const k of KIND_ORDER) { total += data.summary[k]?.total || 0; done += data.summary[k]?.done || 0; }
  return { total, done, left: total - done };
}

const SEND_PATH: Record<TrackerKind, (clientId: string, c: TrackerCell) => { path: string; body: Record<string, unknown> }> = {
  sales: (id, c) => ({ path: `/reports/${c.state === "DC" ? "dc" : "md"}-filing/${id}/send`, body: { periodEnd: c.periodEnd } }),
  withholding: (id, c) => ({ path: `/withholding-filings/${id}/send`, body: { periodEnd: c.periodEnd, state: c.state } }),
  eftps: (_id, c) => ({ path: `/eftps-deposits/${c.recordId}/send`, body: {} }),
  form941: (id, c) => ({ path: `/form941-filings/${id}/${c.periodEnd}/send`, body: {} }),
  ui: (id, c) => ({ path: `/md-ui-filings/${id}/${c.periodEnd}/send`, body: {} }),
};

function csvEscape(v: string): string { return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; }

export function FilingTrackerPage() {
  const confirm = useConfirm();
  const notify = useNotify();
  const toast = useToast();
  const [view, setView] = useState<"board" | "samples">("board");
  const [month, setMonth] = useState<string | null>(null);
  const [earlier, setEarlier] = useState(false);
  const [data, setData] = useState<TrackerData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("attention");
  const [kindFilter, setKindFilter] = useState<TrackerKind | "all">("all");
  const [search, setSearch] = useState("");
  const [sending, setSending] = useState<{ done: number; total: number } | null>(null);
  const notes = useRowNotes("filing");

  function load(m: string | null = month, e: boolean = earlier) {
    setError(null);
    const q = new URLSearchParams();
    if (m) q.set("month", m);
    if (e) q.set("earlier", "1");
    api.get<TrackerData>(`/filing-tracker?${q.toString()}`)
      .then((d) => { setData(d); if (!m) setMonth(d.month); })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load the Filing Tracker."));
  }
  useEffect(() => { load(null, earlier); /* first load picks the month the server suggests */ }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function changeMonth(m: string) { setMonth(m); setData(null); load(m, earlier); }
  function changeEarlier(v: boolean) { setEarlier(v); setData(null); load(month, v); }

  const totals = data ? trackerTotals(data) : null;
  const unsent = useMemo(() => (data ? data.rows.flatMap((r) => r.cells.filter((c) => c.status === "not_sent").map((c) => ({ clientId: r.clientId, clientName: r.clientName, cell: c }))) : []), [data]);

  const rows = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.rows.filter((r) => (!q || r.clientName.toLowerCase().includes(q) || r.clientId.toLowerCase().includes(q))
      && r.cells.some((c) => (kindFilter === "all" || c.kind === kindFilter) && matches(c, filter)));
  }, [data, search, filter, kindFilter]);

  async function sendAllUnsent() {
    if (unsent.length === 0) return;
    const clientCount = new Set(unsent.map((u) => u.clientId)).size;
    const ok = await confirm({
      title: "Send the filing confirmations?",
      message: `${unsent.length} confirmation${unsent.length === 1 ? "" : "s"} for ${clientCount} client${clientCount === 1 ? "" : "s"} will be emailed or texted now — each one is for a filing that is already marked filed and paid. The wording is the same as the Message samples tab.`,
      confirmLabel: `Send ${unsent.length}`,
    });
    if (!ok) return;
    let failed: string[] = [];
    setSending({ done: 0, total: unsent.length });
    for (let i = 0; i < unsent.length; i++) {
      const u = unsent[i];
      try {
        const { path, body } = SEND_PATH[u.cell.kind](u.clientId, u.cell);
        await api.post(path, body);
      } catch (err) {
        failed.push(`${u.clientName} — ${u.cell.label}: ${err instanceof ApiError ? err.message : "could not send"}`);
      }
      setSending({ done: i + 1, total: unsent.length });
    }
    setSending(null);
    load();
    if (failed.length) await notify(`${unsent.length - failed.length} sent, ${failed.length} not sent:\n\n${failed.join("\n")}`, { title: "Some confirmations were not sent" });
    else toast(`Sent ${unsent.length} confirmation${unsent.length === 1 ? "" : "s"}.`);
  }

  function downloadCsv() {
    if (!data) return;
    const lines = [["Client", "Filing", "Period", "Due", "Status", "Filed", "Paid", "Sent to client"].join(",")];
    for (const r of rows) for (const c of r.cells) {
      if (kindFilter !== "all" && c.kind !== kindFilter) continue;
      if (!matches(c, filter)) continue;
      lines.push([r.clientName, c.label, c.periodLabel, c.dueDate, STATUS_TEXT[c.status], c.filedDate || "", c.paidDate || "", c.sentAt ? c.sentAt.slice(0, 10) : ""].map(csvEscape).join(","));
    }
    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = `Filing Tracker ${month || ""} - ${FILTER_LABEL[filter]}.csv`; a.click(); URL.revokeObjectURL(url);
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }} role="tablist" aria-label="Filing Tracker sections">
        <button type="button" role="tab" aria-selected={view === "board"} className={`cc-tab${view === "board" ? " on" : ""}`} onClick={() => setView("board")}>Board</button>
        <button type="button" role="tab" aria-selected={view === "samples"} className={`cc-tab${view === "samples" ? " on" : ""}`} onClick={() => setView("samples")}>Message samples</button>
      </div>

      {view === "samples" ? <MessageSamples /> : (
        <>
          <p className="muted" style={{ marginBottom: 14, maxWidth: 760 }}>
            Every recurring filing for one month's close, in one place: sales tax, withholding, EFTPS, Form 941 and unemployment. A filing is <b>done</b> when it is marked filed, payment is recorded, and the client has been told. Nothing to type here — it reads what the Mark Filed screens already record. Click any status to open that filing.
          </p>

          <div className="command-panel" style={{ marginBottom: 14 }}>
            <div className="command-panel-header">
              <div>
                <h2 className="command-panel-title">{month ? `${monthLabel(month)} filings` : "Loading…"}</h2>
                <div className="command-panel-note">Every filing for a period that ended this month</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", justifyContent: "space-between", padding: "14px 16px 4px" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button type="button" className="btn" onClick={() => month && changeMonth(shiftMonth(month, -1))} aria-label="Previous month">‹</button>
                <input type="month" aria-label="Month the filing periods ended" value={month || ""} onChange={(e) => e.target.value && changeMonth(e.target.value)} style={{ fontWeight: 700 }} />
                <button type="button" className="btn" onClick={() => month && changeMonth(shiftMonth(month, 1))} aria-label="Next month">›</button>
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                <input type="checkbox" checked={earlier} onChange={(e) => changeEarlier(e.target.checked)} />
                Also show unfinished filings from earlier months
              </label>
            </div>
            {totals && (
              <div style={{ padding: "10px 16px 16px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 6 }}>
                  <strong style={{ fontSize: 15 }}>{totals.done} of {totals.total} filings complete</strong>
                  <span className="muted" style={{ fontSize: 13 }}>{totals.left === 0 ? "Everything for this month is done." : `${totals.left} still open`}</span>
                </div>
                <ProgressBar done={totals.done} total={totals.total} />
              </div>
            )}
          </div>

          {error && <ErrorBanner error={error} />}
          {!data && !error && <div className="spinner-wrap">Loading…</div>}

          {data && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 14 }}>
                {KIND_ORDER.map((k) => {
                  const s = data.summary[k];
                  const left = s.total - s.done;
                  return (
                    <button key={k} type="button" className="metric metric-clickable" aria-pressed={kindFilter === k} onClick={() => setKindFilter(kindFilter === k ? "all" : k)}
                      style={{ textAlign: "left", outline: kindFilter === k ? "2px solid var(--teal)" : undefined }}>
                      <div className="metric-label">{KIND_LABEL[k]}</div>
                      <div className="metric-value" style={{ fontSize: 24 }}>{s.done}<span className="muted" style={{ fontSize: 15 }}> / {s.total}</span></div>
                      <ProgressBar done={s.done} total={s.total} color={left === 0 ? "var(--green)" : "var(--teal)"} />
                      <div className="metric-note">
                        {s.total === 0 ? (s.noData ? `${s.noData} waiting for payroll data` : "Nothing due") : [
                          s.notFiled ? `${s.notFiled} not filed` : "", s.unpaid ? `${s.unpaid} payment missing` : "", s.notSent ? `${s.notSent} not sent` : "",
                        ].filter(Boolean).join(" · ") || "All done"}
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="command-panel">
                <div className="command-panel-header">
                  <div>
                    <h2 className="command-panel-title">Clients</h2>
                    <div className="command-panel-note">{rows.length} shown · click a status to open that filing</div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", justifyContent: "space-between", padding: "12px 16px" }}>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }} role="group" aria-label="Show">
                    {(Object.keys(FILTER_LABEL) as Filter[]).map((f) => (
                      <button key={f} type="button" className={`cc-chip${filter === f ? " on" : ""}`} aria-pressed={filter === f} onClick={() => setFilter(f)}
                        style={filter === f ? { background: "var(--ink)", color: "#fff" } : undefined}>{FILTER_LABEL[f]}</button>
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <input type="search" placeholder="Find a client" aria-label="Find a client" value={search} onChange={(e) => setSearch(e.target.value)} style={{ minWidth: 180 }} />
                    <button type="button" className="btn" onClick={downloadCsv}>Download list</button>
                    {unsent.length > 0 && (
                      <button type="button" className="btn btn-primary" disabled={sending !== null} onClick={sendAllUnsent}>
                        {sending ? `Sending ${sending.done}/${sending.total}…` : `Send ${unsent.length} unsent confirmation${unsent.length === 1 ? "" : "s"}`}
                      </button>
                    )}
                  </div>
                </div>

                {rows.length === 0 ? (
                  <p className="muted" style={{ textAlign: "center", padding: 24 }}>
                    {data.rows.length === 0 ? "No filings fall in this month." : filter === "attention" ? "Nothing needs attention here. Every filing shown is complete." : "No clients match."}
                  </p>
                ) : (
                  <>
                  <div className="tracker-cards">
                    {rows.map((r) => (
                      <div key={r.clientId} className="tracker-card">
                        <Link to={`/clients/${r.clientId}`} style={{ fontWeight: 700 }}>{r.clientName}</Link>
                        {!r.canNotify && <div className="muted" style={{ fontSize: 11.5 }}>No email/text consent on file</div>}
                        <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                          {KIND_ORDER.map((k) => {
                            const cs = r.cells.filter((c) => c.kind === k && (kindFilter === "all" || c.kind === kindFilter));
                            return cs.length === 0 ? null : (
                              <div key={k} style={{ display: "grid", gridTemplateColumns: "96px 1fr", gap: 8, alignItems: "start" }}>
                                <span className="muted" style={{ fontSize: 12, fontWeight: 700 }}>{KIND_LABEL[k]}</span>
                                <Cell clientId={r.clientId} cells={cs} notes={notes} />
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="table-scroll tracker-table-wrap">
                    <table className="tracker-table">
                      <thead>
                        <tr>
                          <th style={{ minWidth: 190 }}>Client</th>
                          {KIND_ORDER.map((k) => <th key={k} style={{ minWidth: 150 }}>{KIND_LABEL[k]}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r) => (
                          <tr key={r.clientId}>
                            <td data-label="Client" style={{ verticalAlign: "top" }}>
                              <Link to={`/clients/${r.clientId}`} style={{ fontWeight: 700 }}>{r.clientName}</Link>
                              <div className="muted" style={{ fontSize: 11.5 }}>{r.canNotify ? r.state : `${r.state} · no email/text consent`}</div>
                            </td>
                            {KIND_ORDER.map((k) => (
                              <td key={k} data-label={KIND_LABEL[k]} style={{ verticalAlign: "top" }}>
                                <Cell clientId={r.clientId} cells={r.cells.filter((c) => c.kind === k && (kindFilter === "all" || c.kind === kindFilter))} notes={notes} />
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  </>
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

/** The exact email and text each Mark Filed → Save & Send produces, built by the same code that sends them (never sent from here). */
function MessageSamples() {
  const [samples, setSamples] = useState<MessageSample[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState<Record<string, number>>({});
  useEffect(() => {
    api.get<{ samples: MessageSample[] }>("/filing-tracker/message-samples").then((r) => setSamples(r.samples))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load the samples."));
  }, []);
  if (error) return <ErrorBanner error={error} />;
  if (!samples) return <div className="spinner-wrap">Loading…</div>;
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <p className="muted" style={{ maxWidth: 760, margin: 0 }}>
        What a client receives when you press <b>Save &amp; Send</b> on each kind of filing. These are built by the same code that sends the real messages, with made-up numbers; nothing here is sent. The email goes to clients with email consent, the text to clients with text consent — a client with both gets both. Each email is in English and Arabic.
      </p>
      {samples.map((s) => {
        const i = Math.min(pick[s.id] ?? 0, s.variants.length - 1);
        const v = s.variants[i];
        return (
          <div className="command-panel" key={s.id}>
            <div className="command-panel-header">
              <div>
                <h2 className="command-panel-title">{s.title}</h2>
                <div className="command-panel-note">{s.when}</div>
              </div>
            </div>
            {s.variants.length > 1 && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", padding: "12px 16px 0" }}>
                {s.variants.map((x, xi) => (
                  <button key={x.label} type="button" className={`cc-chip${xi === i ? " on" : ""}`} aria-pressed={xi === i} onClick={() => setPick({ ...pick, [s.id]: xi })}
                    style={xi === i ? { background: "var(--ink)", color: "#fff" } : undefined}>{x.label}</button>
                ))}
              </div>
            )}
            <div style={{ padding: "14px 16px 16px", display: "grid", gap: 12 }}>
              <div>
                <div className="muted" style={{ fontSize: 11.5, fontWeight: 800, textTransform: "uppercase", marginBottom: 4 }}>Email subject</div>
                <div style={{ fontWeight: 700 }}>{v.subject}</div>
              </div>
              <iframe title={`${s.title} email`} sandbox="" srcDoc={v.html} style={{ width: "100%", height: 780, border: "1px solid var(--line)", borderRadius: 8, background: "#fff" }} />
              <div>
                <div className="muted" style={{ fontSize: 11.5, fontWeight: 800, textTransform: "uppercase", marginBottom: 4 }}>Text message</div>
                <div style={{ background: "#eef2f7", borderRadius: 14, padding: "10px 14px", maxWidth: 420, fontSize: 14, lineHeight: 1.45 }}>{v.sms}</div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
