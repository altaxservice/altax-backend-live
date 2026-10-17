/**
 * Filing Tracker — one firm-wide board of every recurring tax filing: for the chosen month, which client has had which filing marked filed,
 * paid and sent to the client, and which has not. It only READS what the Mark Filed screens already record (nothing new to type in):
 * sales tax (MD, DC), state withholding, EFTPS deposits, Form 941 and state unemployment insurance.
 *
 * A client's obligations come from the flags on their profile (sales-tax frequency, withholding frequency, EFTPS, payroll, UI); the periods
 * that ended in the chosen month come from the same due-date helpers the per-client screens use; a period staff excluded ("no filing
 * obligation") is left out. Status per period: not filed → filed, payment missing → paid, client not told → done.
 *
 * Also serves the "Message samples" page: the exact email and text a client gets from each Mark Filed → Save & Send, built by the same
 * functions the real senders use (filingConfirmationEmail.ts) and never sent.
 */
import { Router, Response } from "express";
import { query } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { asyncHandler } from "../../common/asyncHandler";
import { staffClientIds } from "../../common/assignment";
import { splitIntoMdFilingPeriodsForClient } from "../../common/mdFiling";
import { splitIntoDcFilingPeriodsForClient } from "../../common/dcFiling";
import { splitIntoWithholdingPeriods, withholdingDueDate, asWithholdingState, normalizeWithholdingFrequency, type WithholdingFrequency } from "../../common/withholdingFiling";
import { uiDueDate, form941DueDate, eftpsDueDate } from "../../common/obligationSchedules";
import { stateDisplayName, unemploymentInsuranceLabel } from "../../common/stateNames";
import { loadSalesTaxFrequencyHistoryBatch } from "../reports/reports.routes";
import {
  previewFilingConfirmation, previewEftpsDepositReport, previewPaymentDueReminder, type MessagePreview,
} from "../../common/filingConfirmationEmail";

export const filingTrackerRouter = Router();

export type TrackerKind = "sales" | "withholding" | "eftps" | "form941" | "ui";
export type TrackerStatus = "not_filed" | "unpaid" | "scheduled" | "not_sent" | "done" | "no_data";

export interface TrackerCell {
  kind: TrackerKind;
  /** Short column name, with the state where it matters ("MD Sales Tax", "DC Withholding"). */
  label: string;
  state: string;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  status: TrackerStatus;
  filedDate: string | null;
  paidDate: string | null;
  sentAt: string | null;
  acknowledgedAt: string | null;
  /** Past its due date and still not filed, or filed with no payment recorded. */
  overdue: boolean;
  /** The period closed in an earlier month than the one being viewed (only shown on request). */
  carried: boolean;
  /** Whether the client has an email or text consent on file, i.e. whether "send" can actually reach them. */
  canNotify: boolean;
  /** EFTPS deposits are addressed by their own id when sending. */
  recordId: string | null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (isoDate: string, n: number) => iso(new Date(new Date(`${isoDate}T00:00:00Z`).getTime() + n * 86400000));
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Sep 2026", "Q3 2026", "Jan–Jun 2026", "2026" — whatever fits the period's length. */
export function periodLabelFor(start: string, end: string): string {
  const sm = Number(start.slice(5, 7)) - 1, em = Number(end.slice(5, 7)) - 1, y = start.slice(0, 4);
  const months = (Number(end.slice(0, 4)) - Number(start.slice(0, 4))) * 12 + em - sm + 1;
  if (months === 1) return `${MON[sm]} ${y}`;
  if (months === 3 && sm % 3 === 0) return `Q${sm / 3 + 1} ${y}`;
  if (months === 12 && sm === 0) return y;
  return `${MON[sm]}–${MON[em]} ${end.slice(0, 4)}`;
}

function monthBounds(month: string): { start: string; end: string } {
  const [y, m] = month.split("-").map(Number);
  return { start: `${month}-01`, end: iso(new Date(Date.UTC(y, m, 0))) };
}

export function statusOf(rec: { filedDate: string | null; paidDate: string | null; sentAt: string | null } | null, canNotify: boolean, today: string): TrackerStatus {
  if (!rec || !rec.filedDate) return "not_filed";
  if (!rec.paidDate) return "unpaid";
  if (rec.paidDate > today) return "scheduled";
  if (!rec.sentAt && canNotify) return "not_sent";
  return "done";
}

interface Rec { filedDate: string | null; paidDate: string | null; sentAt: string | null; acknowledgedAt: string | null; recordId?: string | null }
const key = (clientId: string, periodEnd: string, extra = "") => `${clientId}|${periodEnd}${extra ? `|${extra}` : ""}`;
const dOnly = (v: unknown): string | null => (v ? String(v).slice(0, 10) : null);
const tOnly = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);

interface ClientRow {
  client_id: string; client_name: string; state: string; sales_tax_frequency: string | null; payroll_enabled: boolean; eftps_enabled: boolean;
  md_withholding_frequency: string | null; mdui_enabled: boolean; email: string | null; email_allowed: boolean; phone: string | null; sms_allowed: boolean;
  assigned_to: string | null;
}

export async function buildFilingTracker(month: string, includeEarlier: boolean, onlyClientIds: Set<string> | null = null) {
  const today = iso(new Date());
  // The board is organised by the month the filing periods END in ("September filings", which are filed and paid in October): every
  // recurring filing for that close (sales tax, withholding, EFTPS, 941, unemployment) lines up under one heading, even when the
  // government due dates fall on different days or slide into the next month.
  const { start: monthStart, end: monthEnd } = monthBounds(month);
  const endFrom = includeEarlier ? addDays(monthStart, -150) : monthStart;
  const endTo = monthEnd;
  const genFrom = addDays(endFrom, -35);
  const genTo = endTo;
  const inWindow = (periodEnd: string) => periodEnd >= endFrom && periodEnd <= endTo;

  const clients = await query<ClientRow>(
    `SELECT client_id, client_name, upper(btrim(COALESCE(state,''))) AS state, sales_tax_frequency, COALESCE(payroll_enabled,false) AS payroll_enabled,
            COALESCE(eftps_enabled,false) AS eftps_enabled, md_withholding_frequency, COALESCE(mdui_enabled,false) AS mdui_enabled,
            email, COALESCE(email_allowed,false) AS email_allowed, phone, COALESCE(sms_allowed,false) AS sms_allowed, assigned_to
       FROM altax.v3_clients WHERE lower(btrim(COALESCE(status,''))) = 'active' ORDER BY client_name`
  );
  if (onlyClientIds) for (let i = clients.length - 1; i >= 0; i--) if (!onlyClientIds.has(clients[i].client_id)) clients.splice(i, 1);
  const ids = clients.map((c) => c.client_id);
  const kinds: TrackerKind[] = ["sales", "withholding", "eftps", "form941", "ui"];
  const summary: Record<string, { total: number; done: number; notFiled: number; unpaid: number; notSent: number; overdue: number; noData: number }> = {};
  for (const k of kinds) summary[k] = { total: 0, done: 0, notFiled: 0, unpaid: 0, notSent: 0, overdue: 0, noData: 0 };
  if (ids.length === 0) return { month, today, kinds, summary, rows: [] as { clientId: string; clientName: string; state: string; assignedTo: string | null; canNotify: boolean; cells: TrackerCell[] }[] };

  const [mdRec, dcRec, whRec, uiRec, f941Rec, eftpsRec, mdEx, dcEx, whEx, obEx, whStates, history, eftpsData] = await Promise.all([
    query<any>(`SELECT client_id, period_end::date::text AS pe, filed_date::date::text AS filed_date, paid_date::date::text AS paid_date, sent_at, acknowledged_at FROM altax.v3_md_filing_payments WHERE period_end >= $1::date AND period_end <= $2::date`, [genFrom, genTo]),
    query<any>(`SELECT client_id, period_end::date::text AS pe, filed_date::date::text AS filed_date, paid_date::date::text AS paid_date, sent_at, acknowledged_at FROM altax.v3_dc_filing_payments WHERE period_end >= $1::date AND period_end <= $2::date`, [genFrom, genTo]),
    query<any>(`SELECT client_id, state, period_end::date::text AS pe, filed_date::date::text AS filed_date, paid_date::date::text AS paid_date, sent_at, acknowledged_at FROM altax.v3_withholding_filings WHERE period_end >= $1::date AND period_end <= $2::date`, [genFrom, genTo]),
    query<any>(`SELECT client_id, period_end::date::text AS pe, filed_date::date::text AS filed_date, paid_date::date::text AS paid_date, sent_at, acknowledged_at FROM altax.v3_md_ui_filings WHERE period_end >= $1::date AND period_end <= $2::date`, [genFrom, genTo]),
    query<any>(`SELECT client_id, period_end::date::text AS pe, filed_date::date::text AS filed_date, paid_date::date::text AS paid_date, sent_at, acknowledged_at FROM altax.v3_form941_filings WHERE period_end >= $1::date AND period_end <= $2::date`, [genFrom, genTo]),
    query<any>(`SELECT deposit_id, client_id, period_end::date::text AS pe, filing_date::date::text AS filing_date, payment_date::date::text AS payment_date, status, updated_at, acknowledged_at FROM altax.v3_eftps_deposits WHERE period_end >= $1::date AND period_end <= $2::date`, [genFrom, genTo]),
    query<any>(`SELECT client_id, period_end::date::text AS pe FROM altax.v3_md_filing_period_exclusions WHERE period_end >= $1::date AND period_end <= $2::date`, [genFrom, genTo]),
    query<any>(`SELECT client_id, period_end::date::text AS pe FROM altax.v3_dc_filing_period_exclusions WHERE period_end >= $1::date AND period_end <= $2::date`, [genFrom, genTo]),
    query<any>(`SELECT client_id, state, period_end::date::text AS pe FROM altax.v3_withholding_period_exclusions WHERE period_end >= $1::date AND period_end <= $2::date`, [genFrom, genTo]),
    query<any>(`SELECT client_id, kind, period_end::date::text AS pe FROM altax.v3_obligation_period_exclusions WHERE period_end >= $1::date AND period_end <= $2::date`, [genFrom, genTo]),
    query<any>(`SELECT client_id, state, frequency FROM altax.v3_client_withholding_states`),
    loadSalesTaxFrequencyHistoryBatch(ids),
    query<any>(`SELECT client_id, to_char(pay_date, 'YYYY-MM') AS ym, count(*) AS n FROM altax.v3_eftps_paycheck_import WHERE pay_date >= $1::date AND pay_date <= $2::date GROUP BY 1,2`, [genFrom, genTo]),
  ]);

  const rec = (rows: any[], extraCol?: string): Map<string, Rec> => new Map(rows.map((r) => [key(r.client_id, r.pe, extraCol ? String(r[extraCol]) : ""), {
    filedDate: dOnly(r.filed_date), paidDate: dOnly(r.paid_date), sentAt: tOnly(r.sent_at), acknowledgedAt: tOnly(r.acknowledged_at),
  }]));
  const mdMap = rec(mdRec), dcMap = rec(dcRec), whMap = rec(whRec, "state"), uiMap = rec(uiRec), f941Map = rec(f941Rec);
  const eftpsMap = new Map<string, Rec>(eftpsRec.map((r: any) => [key(r.client_id, r.pe), {
    filedDate: dOnly(r.filing_date), paidDate: dOnly(r.payment_date), sentAt: r.status === "Sent" ? tOnly(r.updated_at) : null, acknowledgedAt: tOnly(r.acknowledged_at), recordId: r.deposit_id,
  }]));
  const excluded = new Set<string>([
    ...mdEx.map((r: any) => `sales|${r.client_id}|${r.pe}`), ...dcEx.map((r: any) => `sales|${r.client_id}|${r.pe}`),
    ...whEx.map((r: any) => `withholding|${r.client_id}|${r.pe}|${r.state}`), ...obEx.map((r: any) => `${r.kind}|${r.client_id}|${r.pe}`),
  ]);
  const payrollMonths = new Set(eftpsData.map((r: any) => `${r.client_id}|${r.ym}`));
  const extraWh = new Map<string, { state: string; frequency: string }[]>();
  for (const r of whStates) { if (!extraWh.has(r.client_id)) extraWh.set(r.client_id, []); extraWh.get(r.client_id)!.push({ state: String(r.state).toUpperCase(), frequency: r.frequency }); }

  const rows = clients.map((c) => {
    const canNotify = Boolean((c.email_allowed && c.email) || (c.sms_allowed && c.phone));
    const cells: TrackerCell[] = [];
    const push = (kind: TrackerKind, label: string, state: string, p: { start: string; end: string; due: string }, r: Rec | null, exKey: string, noData = false) => {
      if (!inWindow(p.end)) return;
      if (excluded.has(exKey) && !r) return;
      let status: TrackerStatus = noData && !r ? "no_data" : statusOf(r, canNotify, today);
      const overdue = (status === "not_filed" || status === "unpaid") && p.due < today;
      cells.push({
        kind, label, state, periodLabel: periodLabelFor(p.start, p.end), periodStart: p.start, periodEnd: p.end, dueDate: p.due, status,
        filedDate: r?.filedDate ?? null, paidDate: r?.paidDate ?? null, sentAt: r?.sentAt ?? null, acknowledgedAt: r?.acknowledgedAt ?? null,
        overdue, carried: p.end < monthStart, canNotify, recordId: r?.recordId ?? null,
      });
    };

    // Sales tax — Maryland and DC clients with a filing frequency.
    if ((c.state === "MD" || c.state === "DC") && c.sales_tax_frequency) {
      const h = history.get(c.client_id);
      const periods = c.state === "MD"
        ? splitIntoMdFilingPeriodsForClient(genFrom, genTo, h, c.sales_tax_frequency).periods
        : splitIntoDcFilingPeriodsForClient(genFrom, genTo, h, c.sales_tax_frequency).periods;
      for (const p of periods) push("sales", `${c.state} Sales Tax`, c.state, { start: p.start, end: p.end, due: p.dueDate }, (c.state === "MD" ? mdMap : dcMap).get(key(c.client_id, p.end)) ?? null, `sales|${c.client_id}|${p.end}`);
    }

    // State withholding — the home state, plus any other state the client has employees in.
    const whList: { state: string; frequency: string | null }[] = [];
    if (asWithholdingState(c.state)) whList.push({ state: c.state, frequency: c.md_withholding_frequency });
    for (const e of extraWh.get(c.client_id) || []) if (e.state !== c.state && asWithholdingState(e.state)) whList.push({ state: e.state, frequency: e.frequency });
    for (const w of whList) {
      const st = asWithholdingState(w.state)!; const freq = normalizeWithholdingFrequency(w.frequency) as WithholdingFrequency | null;
      if (!freq) continue;
      for (const p of splitIntoWithholdingPeriods(genFrom, genTo, freq)) {
        push("withholding", `${st} Withholding`, st, { start: p.start, end: p.end, due: withholdingDueDate(st, freq, p.end) }, whMap.get(key(c.client_id, p.end, st)) ?? null, `withholding|${c.client_id}|${p.end}|${st}`);
      }
    }

    // EFTPS federal deposit — monthly; a month with no imported payroll cannot be filed yet.
    if (c.eftps_enabled) {
      for (const p of splitIntoWithholdingPeriods(genFrom, genTo, "Monthly")) {
        const r = eftpsMap.get(key(c.client_id, p.end)) ?? null;
        push("eftps", "EFTPS Deposit", "US", { start: p.start, end: p.end, due: eftpsDueDate(p.end) }, r, `eftps|${c.client_id}|${p.end}`, !payrollMonths.has(`${c.client_id}|${p.start.slice(0, 7)}`));
      }
    }

    // Form 941 — quarterly, for every payroll client.
    if (c.payroll_enabled || c.eftps_enabled) {
      for (const p of splitIntoWithholdingPeriods(genFrom, genTo, "Quarterly")) {
        push("form941", "Form 941", "US", { start: p.start, end: p.end, due: form941DueDate(p.end) }, f941Map.get(key(c.client_id, p.end)) ?? null, `form941|${c.client_id}|${p.end}`);
      }
    }

    // State unemployment insurance — quarterly, for clients with UI switched on.
    if (c.mdui_enabled && asWithholdingState(c.state)) {
      for (const p of splitIntoWithholdingPeriods(genFrom, genTo, "Quarterly")) {
        push("ui", `${c.state} Unemployment`, c.state, { start: p.start, end: p.end, due: uiDueDate(c.state, p.end) }, uiMap.get(key(c.client_id, p.end)) ?? null, `ui|${c.client_id}|${p.end}`);
      }
    }

    // When "earlier months" is on, a carried period that is already done is noise — keep only unfinished ones.
    const kept = cells.filter((x) => !x.carried || x.status !== "done");
    return { clientId: c.client_id, clientName: c.client_name, state: c.state, assignedTo: c.assigned_to, canNotify, cells: kept };
  }).filter((r) => r.cells.length > 0);

  for (const r of rows) for (const x of r.cells) {
    const s = summary[x.kind];
    if (x.status === "no_data") { s.noData++; continue; }
    s.total++;
    if (x.status === "done") s.done++; else if (x.status === "not_filed") s.notFiled++; else if (x.status === "not_sent") s.notSent++; else s.unpaid++;
    if (x.overdue) s.overdue++;
  }
  const rank: Record<TrackerStatus, number> = { not_filed: 0, unpaid: 1, scheduled: 2, not_sent: 3, no_data: 5, done: 6 };
  const worst = (cells: TrackerCell[]) => Math.min(...cells.map((x) => rank[x.status]));
  rows.sort((a, b) => worst(a.cells) - worst(b.cells) || Number(b.cells.some((x) => x.overdue)) - Number(a.cells.some((x) => x.overdue)) || a.clientName.localeCompare(b.clientName));
  return { month, today, kinds, summary, rows };
}

filingTrackerRouter.get("/", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const today = iso(new Date());
  // Default: the month that just closed — what is being filed right now.
  const prev = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 2, 1));
  const month = /^\d{4}-\d{2}$/.test(String(req.query.month || "")) ? String(req.query.month) : iso(prev).slice(0, 7);
  // Staff see only the clients they have work assigned on (the same rule canAccessClient applies one client at a time); admins see every client.
  const allowed = await staffClientIds(req.user!);
  res.json(await buildFilingTracker(month, String(req.query.earlier || "") === "1", allowed));
}));

/* ------------------------------ Message samples ------------------------------ */

const SAMPLE_CLIENT = { clientId: "SAMPLE", clientName: "SAMPLE CLIENT LLC", email: "client@example.com", emailAllowed: true, phone: "+1 (410) 555-0100", smsAllowed: true };
const SAMPLE_URL = "https://example.com/public/sample-report";
const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export interface MessageSample { id: string; title: string; when: string; variants: { label: string; subject: string; html: string; sms: string }[] }

export async function buildMessageSamples(req: AuthedRequest): Promise<MessageSample[]> {
  const today = iso(new Date());
  const due = addDays(today, 6);
  const filed = addDays(today, -1);
  const base = { client: SAMPLE_CLIENT, sourceRecordId: "SAMPLE", acknowledgeUrl: SAMPLE_URL, req };
  const two = async (label: string, mk: (paidDate: string | null) => Promise<MessagePreview>) => {
    const unpaid = await mk(null); const paid = await mk(today);
    return [{ label: "Filed — payment not made yet", ...unpaid }, { label, ...paid }];
  };
  const samples: MessageSample[] = [];

  samples.push({
    id: "sales", title: "Sales & Use Tax (Maryland / DC)", when: "Mark Period Filed → Save & Send, or Send after the fact.",
    variants: await two("Filed and paid", (paid) => previewFilingConfirmation({
      ...base, filingType: "Maryland Sales & Use Tax", periodLabel: "Sep 1 – Sep 30, 2026", filedDate: filed, amount: 1284.5,
      amountLabel: "Tax Due", amountLabelAr: "الضريبة المستحقة", paymentDueDate: due, paidDate: paid,
    })),
  });
  samples.push({
    id: "withholding", title: "State withholding", when: "Withholding → Mark Filed → Save & Send.",
    variants: await two("Filed and paid", (paid) => previewFilingConfirmation({
      ...base, filingType: `${stateDisplayName("MD")} Withholding Tax`, periodLabel: "Sep 1 – Sep 30, 2026", filedDate: filed, amount: 842.17,
      amountLabel: "Tax Withheld", amountLabelAr: "الضريبة المستقطعة", paymentDueDate: due, paidDate: paid,
    })),
  });
  samples.push({
    id: "eftps", title: "EFTPS federal deposit", when: "EFTPS Deposits → Mark Filed → Save & Send (a per-employee federal report).",
    variants: [{ label: "Filed and paid", ...(await previewEftpsDepositReport({
      client: SAMPLE_CLIENT, sourceRecordId: "SAMPLE", periodLabel: "Sep 1 – Sep 30, 2026", filingDate: filed, paymentDate: today, dueDate: due,
      federalIncomeTaxTotal: 612.4, socialSecurityTotal: 1043.22, medicareTotal: 243.98, totalAmount: 1899.6,
      employees: [
        { employeeName: "Sample Employee One", federalIncomeTax: 402.1, socialSecurity: 640.0, medicare: 149.67, subtotal: 1191.77 },
        { employeeName: "Sample Employee Two", federalIncomeTax: 210.3, socialSecurity: 403.22, medicare: 94.31, subtotal: 707.83 },
      ],
      acknowledgeUrl: SAMPLE_URL, req,
    })) }],
  });
  samples.push({
    id: "form941", title: "Form 941 quarterly return", when: "Form 941 → Mark Filed → Save & Send.",
    variants: await two("Filed and paid", (paid) => previewFilingConfirmation({
      ...base, filingType: "Federal Payroll Tax (Form 941)", periodLabel: "Q3 2026", filedDate: filed, amount: 215.4,
      amountLabel: "Balance Due", amountLabelAr: "الرصيد المستحق",
      breakdown: [
        { label: "Gross Liability", labelAr: "إجمالي الالتزام", valueStr: money(5865.4) },
        { label: "EFTPS Deposits Applied", labelAr: "الإيداعات المطبقة", valueStr: `−${money(5650)}` },
      ],
      paymentDueDate: due, paidDate: paid,
    })),
  });
  samples.push({
    id: "ui", title: "State unemployment insurance", when: "Unemployment → Mark Filed → Save & Send.",
    variants: await two("Filed and paid", (paid) => previewFilingConfirmation({
      ...base, filingType: unemploymentInsuranceLabel("MD"), periodLabel: "Q3 2026", filedDate: filed, amount: 318.75, paymentDueDate: due, paidDate: paid,
    })),
  });
  samples.push({
    id: "reminder", title: "Payment reminder (automatic)", when: "Sent automatically the day before the payment due date, only when a filing was sent with no payment recorded.",
    variants: [{ label: "Reminder", ...(await previewPaymentDueReminder({ client: SAMPLE_CLIENT, sourceRecordId: "SAMPLE", filingType: "Maryland Sales & Use Tax", periodLabel: "Sep 1 – Sep 30, 2026", amount: 1284.5, paymentDueDate: due, req })) }],
  });
  return samples;
}

filingTrackerRouter.get("/message-samples", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  res.json({ samples: await buildMessageSamples(req) });
}));
