/**
 * Form 941 filing record — Phase 3 of the obligation-workflow rollout,
 * completing the shape EFTPS/MD Sales Tax/Annual Report/MD UI already have.
 * Unlike the others, the amount is never staff-entered or "suggested" — it's
 * always live-recomputed from stored paychecks (computeForm941Quarter,
 * fully deterministic, same "never trust a submitted total" principle as
 * EFTPS/MD Sales Tax) and netted against the quarter's real EFTPS deposits
 * (sumEftpsDepositsInPeriod) to get an honest balance_due, since the raw
 * Form 941 "total taxes" line never subtracts deposits already made.
 */
import { Router, Request, Response } from "express";
import crypto from "crypto";
import { query, queryOne } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { asyncHandler } from "../../common/asyncHandler";
import { canAccessClient } from "../../common/assignment";
import { logAudit } from "../../common/audit";
import { publicBaseUrl } from "../../common/publicUrl";
import { deriveTaskRulesPeriodLabel, closeTaskRulesAgentTask } from "../../common/taskRulesAgentBridge";
import { computeForm941Quarter, sumEftpsDepositsInPeriod } from "../accounting/form941Data";

export const form941FilingsRouter = Router();

// Matches TR-013's real, already-live task_type ("Form 941 Filing") — confirmed
// directly against the database rather than assumed; this rule was seeded
// early (2026-07-08) and has never fired yet (its due dates haven't entered
// the warning window since creation), which is why it wasn't caught by an
// earlier repo-wide grep for a 941 task type — the value only exists as a
// live DB row, not in any SQL migration or the dropdown defaults list.
const TASK_NAME = "Form 941 Filing";
/** Below this, a "balance due" reminder would be misleading noise — most on-schedule quarters net to ~$0 after EFTPS deposits. */
const REMINDER_THRESHOLD = 1;

type LoadClientResult = { error: string; status: number } | { client: { clientId: string; clientName: string; email: string | null; emailAllowed: boolean } };

async function loadClient(req: AuthedRequest, clientId: string): Promise<LoadClientResult> {
  if (!clientId) return { error: "Client is required.", status: 400 };
  if (!(await canAccessClient(req.user!, clientId))) return { error: "You do not have access to this client.", status: 403 };
  const client = await queryOne<any>(`SELECT client_id, client_name, email, email_allowed FROM altax.v3_clients WHERE client_id = $1`, [clientId]);
  if (!client) return { error: "Client not found.", status: 404 };
  return { client: { clientId: client.client_id, clientName: client.client_name, email: client.email, emailAllowed: Boolean(client.email_allowed) } };
}

function quarterPeriod(year: number, quarter: number): { start: string; end: string } {
  const qStartMonth0 = (quarter - 1) * 3;
  const qEndMonth0 = qStartMonth0 + 2;
  const lastDay = new Date(Date.UTC(year, qEndMonth0 + 1, 0)).getUTCDate();
  const pad2 = (n: number) => String(n).padStart(2, "0");
  return { start: `${year}-${pad2(qStartMonth0 + 1)}-01`, end: `${year}-${pad2(qEndMonth0 + 1)}-${pad2(lastDay)}` };
}
/** A DATE column comes back from SELECT * as a JS Date — String(date) gives "Mon Jun 30 2026...", not an ISO string, so the date must be read off the Date object's own toISOString(), not stringified directly. Same fix already applied elsewhere this session (templates.routes.ts's toIsoDateStr). */
function toIsoDateStr(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

/** IRS's real Form 941 due dates (matches complianceCalendar.ts's FORM_941_DUE_DATES). */
function form941DueDate(year: number, quarter: number): string {
  const dueDates: Record<number, [number, number, number]> = {
    1: [year, 4, 30], 2: [year, 7, 31], 3: [year, 10, 31], 4: [year + 1, 1, 31],
  };
  const [dy, dm, dd] = dueDates[quarter];
  return `${dy}-${String(dm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

function parseYearQuarter(req: Request): { year: number; quarter: 1 | 2 | 3 | 4 } | null {
  const year = Number(req.query.year ?? (req.body || {}).year);
  const quarter = Number(req.query.quarter ?? (req.body || {}).quarter);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return null;
  if (![1, 2, 3, 4].includes(quarter)) return null;
  return { year, quarter: quarter as 1 | 2 | 3 | 4 };
}

form941FilingsRouter.get("/", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const clientId = String(req.query.clientId || "").trim();
  const loaded = await loadClient(req, clientId);
  if ("error" in loaded) return res.status(loaded.status).json({ error: loaded.error });
  const rows = await query(`SELECT * FROM altax.v3_form941_filings WHERE client_id = $1 ORDER BY period_end DESC`, [clientId]);
  res.json({ filings: rows });
}));

/**
 * EFTPS-style Review & File: splits the requested range into real quarters
 * (reusing splitIntoMdFilingPeriods with a fixed "Quarterly" frequency —
 * Form 941 has no variable client frequency), and for each quarter returns
 * the live-computed totals plus whether it's already filed.
 */
form941FilingsRouter.get("/review", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const clientId = String(req.query.clientId || "").trim();
  const loaded = await loadClient(req, clientId);
  if ("error" in loaded) return res.status(loaded.status).json({ error: loaded.error });
  const periodStart = String(req.query.periodStart || "").trim();
  const periodEnd = String(req.query.periodEnd || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodStart) || !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) {
    return res.status(400).json({ error: "periodStart and periodEnd must be YYYY-MM-DD." });
  }

  const { splitIntoMdFilingPeriods } = await import("../../common/mdFiling");
  const { periods } = splitIntoMdFilingPeriods(periodStart, periodEnd, "Quarterly");
  if (!periods.length) return res.json({ quarters: [] });

  const existingRows = await query<any>(
    `SELECT * FROM altax.v3_form941_filings WHERE client_id = $1 AND period_end >= $2::date AND period_end <= $3::date`,
    [clientId, periods[0].start, periods[periods.length - 1].end]
  );
  const existingByPeriodEnd = new Map(existingRows.map((r: any) => [toIsoDateStr(r.period_end), r]));

  const quarters = [];
  for (const p of periods) {
    const m = Number(p.start.slice(5, 7));
    const quarter = (Math.floor((m - 1) / 3) + 1) as 1 | 2 | 3 | 4;
    const year = Number(p.start.slice(0, 4));
    const existingRaw = existingByPeriodEnd.get(p.end) || null;
    const existingFiling = existingRaw ? { ...existingRaw, period_end: toIsoDateStr(existingRaw.period_end) } : null;
    let totals = null;
    if (!existingFiling) {
      const computed = await computeForm941Quarter(clientId, year, quarter);
      const eftpsDepositsApplied = await sumEftpsDepositsInPeriod(clientId, p.start, p.end);
      totals = { ...computed, eftpsDepositsApplied, balanceDue: computed.grossLiability - eftpsDepositsApplied };
    }
    quarters.push({ periodStart: p.start, periodEnd: p.end, quarter, year, dueDate: form941DueDate(year, quarter), totals, existingFiling });
  }
  res.json({ quarters });
}));

form941FilingsRouter.post("/mark-filed", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = req.body || {};
  const loaded = await loadClient(req, String(body.clientId || "").trim());
  if ("error" in loaded) return res.status(loaded.status).json({ error: loaded.error });
  const { client } = loaded;
  const parsed = parseYearQuarter(req);
  if (!parsed) return res.status(400).json({ error: "A valid year and quarter (1-4) are required." });

  const filedDate = String(body.filedDate || "").trim();
  const paidDateRaw = String(body.paidDate || "").trim();
  const paidDate = paidDateRaw ? paidDateRaw : null;
  const notify = body.notify === true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(filedDate) || (paidDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(paidDate))) {
    return res.status(400).json({ error: "filedDate (and paidDate, if provided) must be YYYY-MM-DD." });
  }

  const period = quarterPeriod(parsed.year, parsed.quarter);
  const dueDate = form941DueDate(parsed.year, parsed.quarter);

  const existing = await queryOne<{ period_end: string }>(
    `SELECT period_end FROM altax.v3_form941_filings WHERE client_id = $1 AND period_end = $2::date`,
    [client.clientId, period.end]
  );
  if (existing) return res.status(400).json({ error: "A filing for this period has already been recorded. Undo it first if you need to re-file." });

  const totals = await computeForm941Quarter(client.clientId, parsed.year, parsed.quarter);
  const eftpsDepositsApplied = await sumEftpsDepositsInPeriod(client.clientId, period.start, period.end);
  const balanceDue = totals.grossLiability - eftpsDepositsApplied;

  const shareToken = crypto.randomBytes(24).toString("hex");
  const row = await queryOne<{ share_token: string }>(
    `INSERT INTO altax.v3_form941_filings
       (client_id, period_start, period_end, quarter, employee_count, wages, federal_withholding, social_security_wages,
        medicare_wages, gross_liability, eftps_deposits_applied, balance_due, filed_date, paid_date, filed_by, share_token)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     RETURNING share_token`,
    [client.clientId, period.start, period.end, parsed.quarter, totals.employeeCount, totals.wages, totals.federalWithholding,
      totals.socialSecurityWages, totals.medicareWages, totals.grossLiability, eftpsDepositsApplied, balanceDue,
      filedDate, paidDate, req.user!.email, shareToken]
  );
  await logAudit("Accounting", "FORM_941_FILED", client.clientId, "Quarter", "", `${parsed.year} Q${parsed.quarter}: filed ${filedDate}${paidDate ? `, paid ${paidDate}` : ""}`,
    `Form 941 (${parsed.year} Q${parsed.quarter}) marked filed ${filedDate}, balance due ${balanceDue.toFixed(2)} by ${req.user!.email}.`, req.user!.email);

  await closeTaskRulesAgentTask(client.clientId, TASK_NAME, deriveTaskRulesPeriodLabel(period.start, "Quarterly"));

  if (notify) {
    const { sendFilingConfirmation } = await import("../../common/filingConfirmationEmail");
    const sourceRecordId = `${client.clientId}:${period.end}`;
    const periodLabel = `Q${parsed.quarter} ${parsed.year}`;
    const acknowledgeUrl = `${publicBaseUrl(req) || ""}/public/form941/${row?.share_token}`;
    await sendFilingConfirmation({
      client, sourceRecordId, filingType: "Federal Payroll Tax (Form 941)", periodLabel,
      filedDate, amount: balanceDue, paymentDueDate: dueDate, paidDate, acknowledgeUrl, req,
    });
    // A re-file can change the balance (e.g. a client makes another EFTPS
    // deposit for the quarter between two filings of the same period) — a
    // reminder scheduled from an earlier, larger balance must be canceled
    // if the new balance no longer warrants one, not just left stale.
    if (!paidDate && balanceDue > REMINDER_THRESHOLD) {
      const { schedulePaymentReminder } = await import("../../common/paymentReminders");
      await schedulePaymentReminder({
        sourceSystem: "Form941Filing", sourceRecordId, clientId: client.clientId, filingType: "Federal Payroll Tax (Form 941)",
        periodLabel, amount: balanceDue, paymentDueDate: dueDate, createdBy: req.user!.email, leadDays: 3,
      });
    } else {
      const { cancelPaymentReminder } = await import("../../common/paymentReminders");
      await cancelPaymentReminder("Form941Filing", sourceRecordId, paidDate ? "Paid at filing time" : "Balance due is now at or below the reminder threshold");
    }
  }

  res.json({ ok: true, periodEnd: period.end, filedDate, paidDate, balanceDue });
}));

/** Staff-facing PDF, for viewing/printing from within the app — separate from the public token-gated route (publicForm941Filings.routes.ts), which is the client-facing acknowledge page's own download link. Regenerated from the filing's own stored snapshot, same as the public route. */
form941FilingsRouter.get("/:clientId/:periodEnd/pdf", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const loaded = await loadClient(req, req.params.clientId);
  if ("error" in loaded) return res.status(loaded.status).json({ error: loaded.error });
  const { client } = loaded;

  const periodEnd = req.params.periodEnd;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) return res.status(400).json({ error: "periodEnd must be YYYY-MM-DD." });
  const filing = await queryOne<any>(`SELECT * FROM altax.v3_form941_filings WHERE client_id = $1 AND period_end = $2::date`, [client.clientId, periodEnd]);
  if (!filing) return res.status(404).json({ error: "No Form 941 filing found for this period." });

  const clientRow = await queryOne<any>(`SELECT ein, address, state, company_contact_name, phone FROM altax.v3_clients WHERE client_id = $1`, [client.clientId]);
  const { generateForm941 } = await import("../accounting/form941");
  const pdfBytes = await generateForm941({
    employerEin: clientRow?.ein ?? null, employerName: client.clientName, employerAddress: clientRow?.address ?? null, employerState: clientRow?.state ?? null,
    quarter: filing.quarter as 1 | 2 | 3 | 4,
    employeeCount: Number(filing.employee_count), wages: Number(filing.wages),
    federalWithholding: Number(filing.federal_withholding), socialSecurityWages: Number(filing.social_security_wages),
    medicareWages: Number(filing.medicare_wages), contactName: clientRow?.company_contact_name ?? null, contactPhone: clientRow?.phone ?? null,
  });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="941_Q${filing.quarter}_${client.clientId}.pdf"`);
  res.send(Buffer.from(pdfBytes));
}));

form941FilingsRouter.post("/:clientId/:periodEnd/record-payment", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const loaded = await loadClient(req, req.params.clientId);
  if ("error" in loaded) return res.status(loaded.status).json({ error: loaded.error });
  const { client } = loaded;

  const periodEnd = req.params.periodEnd;
  const paidDate = String((req.body || {}).paidDate || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodEnd) || !/^\d{4}-\d{2}-\d{2}$/.test(paidDate)) {
    return res.status(400).json({ error: "periodEnd and paidDate must be YYYY-MM-DD." });
  }
  const existing = await queryOne<any>(`SELECT paid_date FROM altax.v3_form941_filings WHERE client_id = $1 AND period_end = $2::date`, [client.clientId, periodEnd]);
  if (!existing) return res.status(400).json({ error: "This quarter hasn't been marked filed yet — mark it filed first." });
  if (existing.paid_date) return res.status(400).json({ error: "This quarter already has a payment recorded. Use unmark to correct it, then re-record." });

  await query(`UPDATE altax.v3_form941_filings SET paid_date = $3 WHERE client_id = $1 AND period_end = $2::date`, [client.clientId, periodEnd, paidDate]);
  await logAudit("Accounting", "FORM_941_PAYMENT_RECORDED", client.clientId, "Period", "", `${periodEnd}: paid ${paidDate}`,
    `Payment for Form 941 filing (period ending ${periodEnd}) recorded as paid ${paidDate} by ${req.user!.email}.`, req.user!.email);

  const { cancelPaymentReminder } = await import("../../common/paymentReminders");
  await cancelPaymentReminder("Form941Filing", `${client.clientId}:${periodEnd}`, "Payment recorded");

  res.json({ ok: true, periodEnd, paidDate });
}));

form941FilingsRouter.post("/:clientId/:periodEnd/unmark", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const loaded = await loadClient(req, req.params.clientId);
  if ("error" in loaded) return res.status(loaded.status).json({ error: loaded.error });
  const { client } = loaded;

  const periodEnd = req.params.periodEnd;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) return res.status(400).json({ error: "periodEnd must be YYYY-MM-DD." });

  await query(`DELETE FROM altax.v3_form941_filings WHERE client_id = $1 AND period_end = $2::date`, [client.clientId, periodEnd]);
  await logAudit("Accounting", "FORM_941_UNMARKED", client.clientId, "Period", "", periodEnd,
    `Form 941 filing (period ending ${periodEnd}) un-marked by ${req.user!.email}.`, req.user!.email);

  const { cancelPaymentReminder } = await import("../../common/paymentReminders");
  await cancelPaymentReminder("Form941Filing", `${client.clientId}:${periodEnd}`, "Filing un-marked");

  res.json({ ok: true });
}));
