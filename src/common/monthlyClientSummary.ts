import crypto from "crypto";
import { query, queryOne, withTransaction } from "../config/db";
import { sendChannel } from "./sendChannel";
import { getFirmProfile } from "./firmProfile";
import { computeClientBooksPl } from "../modules/accounting/accounting.routes";

/**
 * Monthly "how your business did" email to each business owner: last month's income, expenses and net, sales tax paid,
 * what's waiting on them (documents, unpaid invoices), the next deadlines, and a nudge when sales logging has fallen
 * behind. One email per recipient address — an owner with several businesses gets one email with a section for each.
 * English then Arabic. Idempotent per recipient per month. Skips a business with nothing to say, honours the client's
 * email_allowed / portal / monthly_summary_enabled switches, and never throws for one bad recipient.
 */

const money = (v: number) => `$${(Math.round(v * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const UPLOADED = ["received", "file uploaded", "ready for review"];
const DOC_DONE = ["closed", "completed", "void", "archived"];
const TERMINAL = ["completed", "closed", "archived", "void"];

interface Snapshot {
  clientId: string; clientName: string;
  income: number; expenses: number; net: number; hasBooks: boolean; pending: number;
  taxPaid: number; docsToSend: number; unpaidCount: number; unpaidTotal: number; overdueCount: number;
  next: { name: string; date: string }[]; salesGapDays: number | null;
}

async function snapshot(clientId: string, clientName: string, from: string, to: string, today: string): Promise<Snapshot> {
  const [pl, tax, docs, inv, tasks, sale] = await Promise.all([
    computeClientBooksPl(clientId, from, to).catch(() => null),
    query<any>(`SELECT COALESCE(SUM(tax_due),0) AS paid FROM altax.v3_md_filing_payments WHERE client_id = $1 AND paid_date >= $2::date AND paid_date <= $3::date`, [clientId, from, to]).catch(() => [{ paid: 0 }]),
    query<any>(`SELECT 1 FROM altax.v3_document_requests WHERE client_id = $1 AND lower(COALESCE(status,'')) <> ALL($2::text[])`, [clientId, [...UPLOADED, ...DOC_DONE]]).catch(() => []),
    query<any>(`SELECT balance_due, due_date FROM altax.v3_invoices WHERE client_id = $1 AND lower(COALESCE(status,'')) NOT IN ('paid','void')`, [clientId]).catch(() => []),
    query<any>(`SELECT task_name, agency_due_date FROM altax.v3_tasks WHERE client_id = $1 AND lower(COALESCE(status,'')) <> ALL($2::text[]) AND agency_due_date >= $3::date AND agency_due_date <= ($3::date + interval '45 days') ORDER BY agency_due_date LIMIT 3`, [clientId, TERMINAL, today]).catch(() => []),
    query<any>(`SELECT GREATEST((SELECT MAX(sale_date) FROM altax.v3_client_sales_drafts WHERE client_id = $1 AND status != 'Dismissed'), (SELECT MAX(sale_date) FROM altax.v3_sales_input WHERE client_id = $1)) AS last`, [clientId]).catch(() => [{ last: null }]),
  ]);
  const last = sale[0]?.last ? ymd(new Date(sale[0].last)) : null;
  const gap = last ? Math.round((new Date(`${today}T00:00:00`).getTime() - new Date(`${last}T00:00:00`).getTime()) / 86400000) : null;
  return {
    clientId, clientName,
    income: pl?.totalIncome || 0, expenses: pl?.totalExpenses || 0, net: pl?.netIncome || 0, hasBooks: !!pl && (pl.totalIncome > 0 || pl.totalExpenses > 0), pending: pl ? (pl.pendingSalesCount || 0) + (pl.pendingPurchasesCount || 0) : 0,
    taxPaid: Number(tax[0]?.paid || 0), docsToSend: docs.length,
    unpaidCount: inv.length, unpaidTotal: inv.reduce((s: number, i: any) => s + Number(i.balance_due || 0), 0),
    overdueCount: inv.filter((i: any) => i.due_date && ymd(new Date(i.due_date)) < today).length,
    next: tasks.map((t: any) => ({ name: t.task_name, date: ymd(new Date(t.agency_due_date)) })), salesGapDays: gap,
  };
}

const quiet = (s: Snapshot) => !s.hasBooks && s.taxPaid === 0 && s.docsToSend === 0 && s.unpaidCount === 0 && s.next.length === 0;

function section(s: Snapshot, lang: "en" | "ar", monthLabel: string): string {
  const L = lang === "en"
    ? { results: `${monthLabel} results`, inc: "Income", exp: "Expenses", net: "Net income", taxPaid: "Sales tax paid", docs: (n: number) => `${n} document${n === 1 ? "" : "s"} waiting for you to send`, inv: (n: number, t: number, o: number) => `${n} unpaid invoice${n === 1 ? "" : "s"} (${money(t)})${o ? `, ${o} overdue` : ""}`, next: "Coming up", gap: (n: number) => `Your sales haven't been logged for ${n} days — logging them keeps your books and sales tax estimate current.` }
    : { results: `نتائج ${monthLabel}`, inc: "الدخل", exp: "المصاريف", net: "صافي الدخل", taxPaid: "ضريبة المبيعات المدفوعة", docs: (n: number) => `${n} مستند بانتظار إرسالك`, inv: (n: number, t: number, o: number) => `${n} فاتورة غير مدفوعة (${money(t)})${o ? `، منها ${o} متأخرة` : ""}`, next: "المواعيد القادمة", gap: (n: number) => `لم تُسجَّل مبيعاتك منذ ${n} يوماً — تسجيلها يُبقي دفاترك وتقدير ضريبة المبيعات محدّثين.` };
  const lines = [`■ ${s.clientName}`];
  if (s.hasBooks) lines.push(`${L.results}: ${L.inc} ${money(s.income)} · ${L.exp} ${money(s.expenses)} · ${L.net} ${money(s.net)}${s.pending > 0 ? (lang === "en" ? ` (${s.pending} entr${s.pending === 1 ? "y" : "ies"} still being reviewed)` : ` (${s.pending} إدخالات قيد المراجعة)`) : ""}`);
  if (s.taxPaid > 0) lines.push(`${L.taxPaid}: ${money(s.taxPaid)}`);
  if (s.docsToSend > 0) lines.push(L.docs(s.docsToSend));
  if (s.unpaidCount > 0) lines.push(L.inv(s.unpaidCount, s.unpaidTotal, s.overdueCount));
  if (s.next.length) lines.push(`${L.next}: ${s.next.map((n) => `${n.name} (${n.date})`).join("; ")}`);
  if (s.salesGapDays !== null && s.salesGapDays > 7) lines.push(L.gap(s.salesGapDays));
  return lines.join("\n");
}

export function composeSummary(snaps: Snapshot[], monthEn: string, monthAr: string, firmName: string): { subject: string; body: string } {
  const en = [`Here's how your business${snaps.length > 1 ? "es" : ""} did in ${monthEn}, and what's next.`, ...snaps.map((s) => section(s, "en", monthEn)), "Open your client portal for full reports, assets and documents — or reply to this email with any questions.", `— ${firmName}`].join("\n\n");
  const ar = [`إليك ملخص أداء ${snaps.length > 1 ? "منشآتك" : "منشأتك"} في ${monthAr} وما هو قادم.`, ...snaps.map((s) => section(s, "ar", monthAr)), "ادخل إلى بوابة العميل للاطّلاع على التقارير والأصول والمستندات، أو راسلنا بأي استفسار.", `— ${firmName}`].join("\n\n");
  return { subject: `Your ${monthEn} business summary · ملخص ${monthAr}`, body: `${en}\n\n---\n\n${ar}` };
}

/** Builds (without sending) the summary one recipient would get — used by the admin preview and the sender. */
export async function buildSummaryForClients(clientIds: { clientId: string; clientName: string }[], now = new Date()): Promise<{ subject: string; body: string; skipped: boolean }> {
  const from = ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  const to = ymd(new Date(now.getFullYear(), now.getMonth(), 0));
  const monthEn = new Date(now.getFullYear(), now.getMonth() - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const monthAr = new Date(now.getFullYear(), now.getMonth() - 1, 1).toLocaleDateString("ar", { month: "long", year: "numeric" });
  const today = ymd(now);
  const snaps = (await Promise.all(clientIds.map((c) => snapshot(c.clientId, c.clientName, from, to, today)))).filter((s) => !quiet(s));
  const firm = (await getFirmProfile()).firmName;
  if (!snaps.length) return { subject: "", body: "", skipped: true };
  return { ...composeSummary(snaps, monthEn, monthAr, firm), skipped: false };
}

/** Firm-wide master switch (v3_firm_settings) — defaults OFF so nothing goes to clients until an admin has previewed the email and turned it on. */
export async function isMonthlySummaryEnabled(): Promise<boolean> {
  try {
    const row = await queryOne<any>(`SELECT monthly_client_summary_enabled AS v FROM altax.v3_firm_settings WHERE id = 'FIRM-1'`);
    return row?.v === true;
  } catch { return false; }
}

export async function runMonthlyClientSummaries(actorEmail: string): Promise<{ sent: number; skipped: number; errors: string[] }> {
  if (!(await isMonthlySummaryEnabled())) return { sent: 0, skipped: 0, errors: ["Master switch is off — no monthly summaries were sent."] };
  const monthKey = ymd(new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1)).slice(0, 7);
  const errors: string[] = [];
  const clients = await query<any>(
    `SELECT client_id, client_name, lower(email) AS email FROM altax.v3_clients
      WHERE email IS NOT NULL AND email <> '' AND email_allowed = true AND COALESCE(portal_enabled, true) = true AND monthly_summary_enabled = true
        AND (status IS NULL OR lower(status) NOT IN ('no','false','inactive','archived'))
      ORDER BY client_name`);
  const byEmail = new Map<string, { clientId: string; clientName: string }[]>();
  for (const c of clients) { if (!byEmail.has(c.email)) byEmail.set(c.email, []); byEmail.get(c.email)!.push({ clientId: c.client_id, clientName: c.client_name }); }

  const firmName = (await getFirmProfile()).firmName;
  let sent = 0, skipped = 0;
  for (const [email, businesses] of byEmail) {
    try {
      const key = `MCS-${email}-${monthKey}`;
      const already = await query<any>(`SELECT 1 FROM altax.v3_communications WHERE source_system = 'MonthlyClientSummary' AND source_record_id = $1`, [key]);
      if (already.length) { skipped++; continue; }
      const built = await buildSummaryForClients(businesses);
      if (built.skipped) { skipped++; continue; }
      let outcome: { sent: boolean; already?: boolean; err?: string } = { sent: false };
      await withTransaction(async (db) => {
        await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [key]);
        const dup = await db.queryOne<any>(`SELECT 1 FROM altax.v3_communications WHERE source_system = 'MonthlyClientSummary' AND source_record_id = $1`, [key]);
        if (dup) { outcome = { sent: false, already: true }; return; }
        const result = await sendChannel("email", email, built.subject, built.body, { firmName });
        await db.query(
          `INSERT INTO altax.v3_communications (communication_id, client_id, client_name, related_task_id, subject, message_english, message_arabic, sent_to, sent_by, direction, channel, sent_at, status, source_system, source_record_id, provider_message_id)
           VALUES ($1,$2,$3,NULL,$4,$5,'',$6,$7,'Outbound','Email',now(),$8,'MonthlyClientSummary',$9,$10)`,
          [`COM-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}-${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`, businesses[0].clientId, businesses[0].clientName, built.subject, built.body, email, actorEmail, result.sent ? "Sent" : "Failed", key, result.providerMessageId || null]);
        outcome = { sent: result.sent, err: result.error };
      });
      if (outcome.sent) sent++; else { skipped++; if (!outcome.already && outcome.err) errors.push(`${email}: ${outcome.err}`); }
    } catch (err: any) {
      skipped++; errors.push(`${email}: ${err?.message || "failed"}`);
      // eslint-disable-next-line no-console
      console.error(`[runMonthlyClientSummaries] ${email}:`, err);
    }
  }
  return { sent, skipped, errors };
}
