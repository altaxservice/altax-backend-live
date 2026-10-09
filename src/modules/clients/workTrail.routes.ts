/**
 * Automatic "where you left off" for a client: a merged, newest-first trail of what has actually been done on the
 * client (sales and payroll entered, filings marked filed/paid, deposits, tasks, messages, documents, invoices, profile
 * edits), read straight from the tables those actions already write to — no extra step for staff. Each staff member's
 * own visits are remembered too, so the page can mark everything that happened since they last worked on the client.
 * Mounted at /clients before clientsRouter (literal "recent-work" must not be read as a :clientId).
 */
import { Router, Response } from "express";
import { query } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { asyncHandler } from "../../common/asyncHandler";
import { canAccessClient } from "../../common/assignment";

export const workTrailRouter = Router();

export interface TrailEvent {
  at: string;
  by: string | null;
  kind: string;
  label: string;
  detail?: string;
  /** Where this work lives: a tab on the client's own page, or a tab on the Accounting page. */
  page?: "client" | "accounting";
  tab?: string;
  count?: number;
}

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : "");
const ymd = (v: unknown) => (v ? new Date(v as string).toISOString().slice(0, 10) : "");
const usd = (n: unknown) => `$${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const monthYear = (v: unknown) => (v ? new Date(v as string).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" }) : "");
const period = (s: unknown, e: unknown) => {
  const a = monthYear(s), b = monthYear(e);
  return a === b ? a : `${a} – ${b}`;
};
const shortDate = (v: unknown) => (v ? new Date(v as string).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "");

/** Two events of the same kind within this many minutes read as one burst of work (an import of nine months is one entry, not nine). */
const BURST_MINUTES = 15;

function mergeBursts(events: TrailEvent[]): TrailEvent[] {
  const out: TrailEvent[] = [];
  for (const e of events) {
    const prev = out[out.length - 1];
    const gap = prev ? Math.abs(new Date(prev.at).getTime() - new Date(e.at).getTime()) / 60000 : Infinity;
    if (prev && prev.kind === e.kind && ["sales", "payroll", "document", "message"].includes(e.kind) && gap <= BURST_MINUTES && prev.by === e.by) {
      prev.count = (prev.count || 1) + 1;
    } else {
      out.push({ ...e });
    }
  }
  return out.map((e) => {
    if (!e.count || e.count < 2) return e;
    const noun: Record<string, string> = { sales: "Sales entered", payroll: "Payroll recorded", document: "Documents added", message: "Messages" };
    return { ...e, label: `${noun[e.kind] || e.label} × ${e.count}`, detail: undefined };
  });
}

export async function loadWorkTrail(clientId: string, limit = 25): Promise<TrailEvent[]> {
  const since = "now() - interval '180 days'";
  const q = (sql: string) => query<any>(sql, [clientId]).catch(() => [] as any[]);
  const [sales, payroll, mdTax, withholding, ui, annual, f941, eftps, tasks, comms, docs, invoices, client, govForms, contracts, returns] = await Promise.all([
    q(`SELECT sale_date, gross_sales, created_at FROM altax.v3_sales_input WHERE client_id = $1 AND created_at > ${since} ORDER BY created_at DESC LIMIT 40`),
    q(`SELECT pay_date, employee, created_at FROM altax.v3_payroll_input WHERE client_id = $1 AND created_at > ${since} ORDER BY created_at DESC LIMIT 60`),
    q(`SELECT period_start, period_end, filed_date, paid_date, filed_by, filed_at, acknowledged_at FROM altax.v3_md_filing_payments WHERE client_id = $1 AND filed_at > ${since} ORDER BY filed_at DESC LIMIT 10`),
    q(`SELECT state, period_start, period_end, filed_date, paid_date, filed_by, filed_at FROM altax.v3_withholding_filings WHERE client_id = $1 AND filed_at > ${since} ORDER BY filed_at DESC LIMIT 10`),
    q(`SELECT period_start, period_end, filed_date, paid_date, filed_by, filed_at FROM altax.v3_md_ui_filings WHERE client_id = $1 AND filed_at > ${since} ORDER BY filed_at DESC LIMIT 6`),
    q(`SELECT period_start, period_end, filed_date, paid_date, filed_by, filed_at FROM altax.v3_annual_report_filings WHERE client_id = $1 AND filed_at > ${since} ORDER BY filed_at DESC LIMIT 4`),
    q(`SELECT period_start, period_end, quarter, filed_date, paid_date, filed_by, filed_at FROM altax.v3_form941_filings WHERE client_id = $1 AND filed_at > ${since} ORDER BY filed_at DESC LIMIT 6`),
    q(`SELECT period_start, period_end, status, filing_date, payment_date, total_amount, created_by, updated_at FROM altax.v3_eftps_deposits WHERE client_id = $1 AND updated_at > ${since} ORDER BY updated_at DESC LIMIT 10`),
    q(`SELECT task_name, status, updated_at, updated_by FROM altax.v3_tasks WHERE client_id = $1 AND updated_at > ${since} ORDER BY updated_at DESC LIMIT 12`),
    q(`SELECT channel, subject, status, sent_by, sent_at FROM altax.v3_communications WHERE client_id = $1 AND direction = 'Outbound' AND sent_at > ${since} AND sent_by NOT ILIKE 'System%' ORDER BY sent_at DESC LIMIT 12`),
    q(`SELECT file_name, direction, uploaded_by, uploaded_at FROM altax.v3_document_uploads WHERE client_id = $1 AND uploaded_at > ${since} AND lower(coalesce(status,'')) NOT IN ('removed','replaced') ORDER BY uploaded_at DESC LIMIT 12`),
    q(`SELECT invoice_id, status, total_amount, updated_at FROM altax.v3_invoices WHERE client_id = $1 AND updated_at > ${since} ORDER BY updated_at DESC LIMIT 8`),
    q(`SELECT updated_at, updated_by FROM altax.v3_clients WHERE client_id = $1`),
    q(`SELECT form_type, status, signer_name, updated_at FROM altax.v3_gov_form_filings WHERE client_id = $1 AND updated_at > ${since} ORDER BY updated_at DESC LIMIT 8`),
    q(`SELECT title, status, updated_at FROM altax.v3_client_contracts WHERE client_id = $1 AND updated_at > ${since} ORDER BY updated_at DESC LIMIT 8`),
    q(`SELECT tax_year, return_type, status, updated_at, updated_by FROM altax.v3_tax_returns WHERE client_id = $1 AND updated_at > ${since} ORDER BY updated_at DESC LIMIT 8`),
  ]);

  const paidText = (paid: unknown, filed: unknown) => `filed ${shortDate(filed)} · ${paid ? `paid ${shortDate(paid)}` : "payment not recorded yet"}`;
  const events: TrailEvent[] = [];
  for (const r of sales) events.push({ at: iso(r.created_at), by: null, kind: "sales", label: `Sales entered · ${shortDate(r.sale_date)}`, detail: usd(r.gross_sales), page: "accounting", tab: "Sales" });
  for (const r of payroll) events.push({ at: iso(r.created_at), by: null, kind: "payroll", label: `Payroll recorded · ${shortDate(r.pay_date)}`, detail: r.employee || undefined, page: "accounting", tab: "Payroll" });
  for (const r of mdTax) {
    events.push({ at: iso(r.filed_at), by: r.filed_by, kind: "filing", label: `MD sales tax ${period(r.period_start, r.period_end)}`, detail: paidText(r.paid_date, r.filed_date), page: "accounting", tab: "Sales" });
    if (r.acknowledged_at) events.push({ at: iso(r.acknowledged_at), by: "Client", kind: "filing", label: `Client confirmed MD sales tax ${period(r.period_start, r.period_end)}`, page: "accounting", tab: "Sales" });
  }
  for (const r of withholding) events.push({ at: iso(r.filed_at), by: r.filed_by, kind: "filing", label: `${r.state || ""} withholding ${period(r.period_start, r.period_end)}`.trim(), detail: paidText(r.paid_date, r.filed_date), page: "accounting", tab: "Withholding" });
  for (const r of ui) events.push({ at: iso(r.filed_at), by: r.filed_by, kind: "filing", label: `Unemployment (UI) ${period(r.period_start, r.period_end)}`, detail: paidText(r.paid_date, r.filed_date), page: "accounting", tab: "MD UI" });
  for (const r of annual) events.push({ at: iso(r.filed_at), by: r.filed_by, kind: "filing", label: `Annual report ${period(r.period_start, r.period_end)}`, detail: paidText(r.paid_date, r.filed_date), page: "accounting", tab: "Annual Report" });
  for (const r of f941) events.push({ at: iso(r.filed_at), by: r.filed_by, kind: "filing", label: `Form 941 ${r.quarter ? `Q${r.quarter} ` : ""}${period(r.period_start, r.period_end)}`, detail: paidText(r.paid_date, r.filed_date), page: "accounting", tab: "Form 941" });
  for (const r of eftps) events.push({ at: iso(r.updated_at), by: r.created_by, kind: "filing", label: `EFTPS deposit ${period(r.period_start, r.period_end)}`, detail: `${r.status || "In progress"} · ${usd(r.total_amount)}${r.payment_date ? ` · paid ${shortDate(r.payment_date)}` : ""}`, page: "accounting", tab: "EFTPS Deposits" });
  for (const r of tasks) events.push({ at: iso(r.updated_at), by: r.updated_by, kind: "task", label: `Task “${r.task_name}”`, detail: r.status || undefined, page: "client", tab: "Tasks" });
  for (const r of comms) events.push({ at: iso(r.sent_at), by: r.sent_by, kind: "message", label: `${r.channel}: ${r.subject}`, detail: String(r.status || "").startsWith("Saved +") ? "sent" : "logged", page: "client", tab: "Communications" });
  for (const r of docs) events.push({ at: iso(r.uploaded_at), by: r.uploaded_by, kind: "document", label: `Document: ${r.file_name}`, detail: r.direction || undefined, page: "client", tab: "Documents" });
  for (const r of invoices) events.push({ at: iso(r.updated_at), by: null, kind: "invoice", label: `Invoice ${r.invoice_id} · ${r.status}`, detail: usd(r.total_amount), page: "client", tab: "Billing" });
  for (const r of govForms) events.push({ at: iso(r.updated_at), by: null, kind: "form", label: `Government form ${r.form_type}`, detail: r.status || undefined, page: "client", tab: "Gov Forms" });
  for (const r of contracts) events.push({ at: iso(r.updated_at), by: null, kind: "contract", label: `Contract “${r.title}”`, detail: r.status || undefined, page: "client", tab: "Contracts" });
  for (const r of returns) events.push({ at: iso(r.updated_at), by: r.updated_by, kind: "return", label: `${r.tax_year} ${r.return_type || "tax return"}`, detail: r.status || undefined, page: "client", tab: "Tax Return Production" });
  if (client[0]?.updated_at && new Date(client[0].updated_at).getTime() > Date.now() - 180 * 86400000) {
    events.push({ at: iso(client[0].updated_at), by: client[0].updated_by || null, kind: "profile", label: "Client profile edited", page: "client", tab: "Profile" });
  }

  events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  return mergeBursts(events.filter((e) => e.at)).slice(0, limit);
}

/** Records this staff member's visit and returns the previous working session's start ("since you were last here"). */
async function touchVisit(email: string, clientId: string): Promise<string | null> {
  const rows = await query<any>(
    `INSERT INTO altax.v3_client_visits (user_email, client_id, last_visit_at, prev_visit_at)
     VALUES ($1, $2, now(), NULL)
     ON CONFLICT (user_email, client_id) DO UPDATE SET
       prev_visit_at = CASE WHEN altax.v3_client_visits.last_visit_at < now() - interval '30 minutes' THEN altax.v3_client_visits.last_visit_at ELSE altax.v3_client_visits.prev_visit_at END,
       last_visit_at = now()
     RETURNING prev_visit_at`,
    [email.toLowerCase(), clientId]
  );
  return rows[0]?.prev_visit_at ? new Date(rows[0].prev_visit_at).toISOString() : null;
}

/** The clients this person worked on most recently, each with what was last done there — the Command Center's "pick up where you left off". Registered before /:clientId/... routes. */
workTrailRouter.get("/recent-work", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const rows = await query<any>(
    `SELECT v.client_id, v.last_visit_at, c.client_name, c.status
       FROM altax.v3_client_visits v JOIN altax.v3_clients c ON c.client_id = v.client_id
      WHERE v.user_email = $1 ORDER BY v.last_visit_at DESC LIMIT 8`,
    [req.user!.email.toLowerCase()]
  );
  const items = [];
  for (const r of rows) {
    if (!(await canAccessClient(req.user!, r.client_id))) continue;
    const trail = await loadWorkTrail(r.client_id, 3);
    items.push({ clientId: r.client_id, clientName: r.client_name, status: r.status, lastVisitAt: new Date(r.last_visit_at).toISOString(), latest: trail[0] || null });
  }
  res.json({ items });
}));

workTrailRouter.get("/:clientId/work-trail", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) return res.status(403).json({ error: "You do not have access to this client." });
  const sinceVisit = String(req.query.visit || "") === "1" ? await touchVisit(req.user!.email, clientId) : null;
  const events = await loadWorkTrail(clientId, 25);
  res.json({ events, sinceVisit, me: req.user!.email.toLowerCase() });
}));
