/**
 * Compliance deadline reminders to CLIENTS — direct owner request,
 * 2026-08-26: "Your company Annual Report is due in..., your sales tax
 * filing due on..." Builds on the existing pieces rather than duplicating
 * them: computeUpcomingDeadlines (complianceCalendar.ts) is the same
 * engine that already powers the client dashboard's Upcoming Deadlines
 * list and the "MD Annual Report is N days overdue" banner; sendChannel
 * (sendChannel.ts) is the same branded email/SMS delivery path every
 * other client-facing send in this app already uses. MD Sales Tax keeps
 * its own dedicated sweep (runClientMdSalesTaxDeadlineNotifications,
 * clients.routes.ts) — not touched, and deliberately excluded from the
 * sweep below so a client never gets the same filing reminded twice by
 * two different sweeps.
 */
import { query, queryOne } from "../config/db";
import { sendChannel } from "./sendChannel";
import { getFirmProfile } from "./firmProfile";
import { logAudit } from "./audit";
import { computeUpcomingDeadlines, type ComplianceDeadline } from "../modules/clients/complianceCalendar";

/** Same 9 sources as MARKABLE_DEADLINE_SOURCES on the frontend (ClientAtAGlance.tsx) — a source only gets a client reminder if it's already a real, actionable obligation elsewhere in the app. */
export const REMINDABLE_SOURCES = new Set([
  "EFTPS", "MD Withholding", "MD UI", "Business Tax Return", "Individual Tax Return",
  "Estimated Tax", "MD Annual Report", "Federal Payroll Tax", "1099/W-2",
]);

export interface ComplianceReminderSetting { source: string; leadDays: number[]; enabled: boolean }

export async function getComplianceReminderSettings(): Promise<ComplianceReminderSetting[]> {
  const rows = await query<{ source: string; lead_days: number[]; enabled: boolean }>(
    `SELECT source, lead_days, enabled FROM altax.v3_compliance_reminder_settings ORDER BY source`
  );
  return rows.map((r) => ({ source: r.source, leadDays: r.lead_days, enabled: r.enabled }));
}

/**
 * Stable identity for one reminder "slot" (this client, this obligation,
 * this due date) — a `#` separates it from a uniqueness suffix appended by
 * each actual send (`#auto#${daysUntil}` or `#manual#${timestamp}`), so
 * "last sent for this slot" is always `source_record_id.split("#")[0]`
 * regardless of how many times or which way it's been sent. `#` (not `:`)
 * on purpose — a flag key can itself contain colons (e.g.
 * "computed:SalesTaxFilingDue:md:2026-06-30"), which would make splitting
 * on ":" ambiguous.
 */
export function deadlineReminderStableKey(clientId: string, source: string, date: string): string {
  return `${clientId}:${source}:${date}`;
}
export function flagReminderStableKey(clientId: string, flagKey: string): string {
  return `${clientId}:flag:${flagKey}`;
}

function daysBetween(dateStr: string, asOfStr: string): number {
  return Math.round((new Date(`${dateStr}T00:00:00Z`).getTime() - new Date(`${asOfStr}T00:00:00Z`).getTime()) / 86400000);
}

/** "April 15, 2026" — US long-date format, direct owner request (2026-08-26, real messages were going out with a raw "2026-04-15"). Unambiguous (no MM/DD-vs-DD/MM confusion) and reads as an official notice, not a log timestamp. */
export function fmtUsDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

/**
 * Deliberately simple content, per the owner's explicit request — not a
 * detailed breakdown, just "this is due, contact us." Revised 2026-08-26
 * after reviewing real sent copies: the SMS previously stuttered
 * ("AL Tax Service: ALMABARI INC: reminder...") because sendChannel.ts
 * already prefixes the firm name onto every SMS body — this no longer
 * repeats the client's name there. The email gets a highlighted callout
 * around the actual due-date sentence (plain HTML embedded directly in the
 * body string — sendChannel's bodyToDirectionalHtml only converts
 * newlines to <br>, it doesn't escape markup, so real tags render as
 * intended) instead of a flat paragraph. Bilingual: the email body joins
 * EN/AR with the "---" divider bodyToDirectionalHtml already knows how to
 * split and render RTL/LTR correctly; SMS stays English-only, matching
 * the existing MD Sales Tax reminder SMS (a second Arabic SMS would
 * double the message count for no real benefit at SMS length).
 */
export function buildComplianceReminderMessage(clientName: string, label: string, dueDate: string, daysUntil: number, firmName: string): { subject: string; body: string; smsBody: string } {
  const dateUs = fmtUsDate(dueDate);
  const dayWordEn = daysUntil < 0 ? `${Math.abs(daysUntil)} day${Math.abs(daysUntil) === 1 ? "" : "s"} overdue` : daysUntil === 0 ? "today" : daysUntil === 1 ? "tomorrow" : `in ${daysUntil} days`;
  const dayWordAr = daysUntil < 0 ? `متأخر ${Math.abs(daysUntil)} يومًا` : daysUntil === 0 ? "اليوم" : daysUntil === 1 ? "غدًا" : `خلال ${daysUntil} يومًا`;
  const subject = `Reminder: ${label} Due ${dateUs}`;

  // white-space:nowrap on the date keeps "April 15, 2026" from breaking
  // mid-date across lines on a narrow (phone) screen — direct owner
  // feedback, 2026-08-26, from a real received email screenshot.
  const calloutEn = `<div style="margin:16px 0; padding:14px 18px; background:#fdf6e8; border-left:4px solid #a9834a; border-radius:4px;"><strong>${label}</strong> is due on <strong style="white-space:nowrap;">${dateUs}</strong> (${dayWordEn}).</div>`;
  const calloutAr = `<div dir="rtl" style="margin:16px 0; padding:14px 18px; background:#fdf6e8; border-right:4px solid #a9834a; border-radius:4px; text-align:right;"><strong>${label}</strong> مستحق بتاريخ <strong style="white-space:nowrap;">${dateUs}</strong> (${dayWordAr}).</div>`;
  const en = `Dear ${clientName},\n\nThis is a reminder that your\n${calloutEn}\nPlease contact us regarding this matter.\n\nThank you,\n${firmName}`;
  const ar = `عزيزنا ${clientName}،\n\nهذا تذكير بأن\n${calloutAr}\nيرجى التواصل معنا بخصوص هذا الأمر.\n\nشكراً لكم،\n${firmName}`;
  const body = `${en}\n\n---\n\n${ar}`;
  const smsBody = `Reminder: your ${label} is due ${dateUs} (${dayWordEn}). Please contact us regarding this matter.`;
  return { subject, body, smsBody };
}

/**
 * Gathers the same per-client inputs reports.routes.ts's GET
 * /reports/client-dashboard/:clientId feeds into computeUpcomingDeadlines
 * — mirrored here rather than imported, same "deliberately DB-access-free"
 * reasoning as complianceCalendar.ts's own top comment, and the same
 * convention complianceGapFlags.ts already follows for its own firm-wide
 * sweep. Excludes MD Sales Tax (mdCurrentPeriodDueDate always null) — that
 * source has its own dedicated sweep already.
 */
async function computeClientDeadlines(c: any, asOf: Date): Promise<ComplianceDeadline[]> {
  const [nextPayrollRow, has2553Row, completionRows] = await Promise.all([
    queryOne<any>(`SELECT MIN(next_pay_date) AS next_pay_date FROM altax.v3_payroll_schedules WHERE client_id = $1 AND status = 'Active'`, [c.client_id]),
    queryOne<any>(`SELECT 1 FROM altax.v3_gov_form_filings WHERE client_id = $1 AND form_type = '2553' AND status != 'Void' LIMIT 1`, [c.client_id]),
    query<any>(`SELECT source, due_date FROM altax.v3_obligation_completions WHERE client_id = $1`, [c.client_id]),
  ]);
  const completedKeys = new Set(completionRows.map((r: any) => `${r.source}|${new Date(r.due_date).toISOString().slice(0, 10)}`));

  return computeUpcomingDeadlines({
    mdCurrentPeriodDueDate: null,
    payrollNextDate: nextPayrollRow?.next_pay_date ? new Date(nextPayrollRow.next_pay_date).toISOString().slice(0, 10) : null,
    payrollEnabled: false, // "Payroll" (next pay date) isn't a client-facing compliance reminder — see REMINDABLE_SOURCES
    mdAnnualReportEnabled: Boolean(c.md_annual_report_enabled),
    entityType: c.entity_type || null,
    dateOfFormation: c.date_of_formation ? new Date(c.date_of_formation).toISOString().slice(0, 10) : null,
    has2553Filing: Boolean(has2553Row),
    eftpsEnabled: Boolean(c.eftps_enabled),
    mdWithholdingFrequency: c.md_withholding_frequency || null,
    mduiEnabled: Boolean(c.mdui_enabled),
    businessReturnType: c.business_return_type || null,
    clientType: c.client_type || null,
    w21099Enabled: Boolean(c.w21099_enabled),
    completedKeys,
    withinDays: 90,
    asOf,
  });
}

/**
 * Daily sweep — for every active client, every REMINDABLE_SOURCES deadline,
 * checks whether today is exactly one of that source's configured lead
 * days out, and if so sends (subject to the client's own email_allowed/
 * sms_allowed/preferred_language). Dedup key includes the lead-day number
 * so a source configured with multiple lead days (e.g. Annual Report at 14
 * and 3) correctly fires once per threshold, not once total.
 */
export async function runComplianceDeadlineReminders(actorEmail: string): Promise<{ sent: number; skipped: number }> {
  const settingsList = await getComplianceReminderSettings();
  const settings = new Map(settingsList.map((s) => [s.source, s]));
  const firmName = (await getFirmProfile()).firmName;
  const asOf = new Date();
  const asOfStr = asOf.toISOString().slice(0, 10);

  const clients = await query<any>(
    `SELECT client_id, client_name, email, phone, email_allowed, sms_allowed,
            payroll_enabled, md_annual_report_enabled, entity_type, date_of_formation, eftps_enabled,
            md_withholding_frequency, mdui_enabled, business_return_type, client_type, w21099_enabled
       FROM altax.v3_clients
      WHERE auto_compliance_reminders_enabled = true
            AND (status IS NULL OR lower(status) NOT IN ('no', 'false', 'inactive', 'archived'))`
  );

  let sent = 0;
  let skipped = 0;
  for (const c of clients) {
    try {
      const deadlines = await computeClientDeadlines(c, asOf);
      for (const d of deadlines) {
        if (!REMINDABLE_SOURCES.has(d.source)) continue;
        const setting = settings.get(d.source);
        if (!setting || !setting.enabled) continue;
        const daysUntil = daysBetween(d.date, asOfStr);
        if (daysUntil < 0 || !setting.leadDays.includes(daysUntil)) continue;

        const dedupKey = `${deadlineReminderStableKey(c.client_id, d.source, d.date)}#auto#${daysUntil}`;
        const already = await queryOne<any>(
          `SELECT 1 FROM altax.v3_communications WHERE source_system = 'ComplianceReminder' AND source_record_id = $1`,
          [dedupKey]
        );
        if (already) continue;

        const canEmail = Boolean(c.email_allowed && c.email);
        const canSms = Boolean(c.sms_allowed && c.phone);
        if (!canEmail && !canSms) { skipped++; continue; }

        const { subject, body, smsBody } = buildComplianceReminderMessage(c.client_name, d.label, d.date, daysUntil, firmName);

        let anySent = false;
        let providerMessageId: string | null = null;
        if (canEmail) {
          const emailResult = await sendChannel("email", c.email, subject, body, { firmName });
          if (emailResult.sent) { anySent = true; providerMessageId = emailResult.providerMessageId || null; }
        }
        if (canSms) {
          const smsResult = await sendChannel("sms", c.phone, subject, smsBody, { firmName });
          if (smsResult.sent) { anySent = true; providerMessageId = providerMessageId || smsResult.providerMessageId || null; }
        }

        await query(
          `INSERT INTO altax.v3_communications
             (communication_id, client_id, client_name, related_task_id, subject, message_english, message_arabic,
              sent_to, sent_by, direction, channel, sent_at, status, source_system, source_record_id, provider_message_id)
           VALUES ($1,$2,$3,NULL,$4,$5,'',$6,$7,'Outbound','Email',now(),$8,'ComplianceReminder',$9,$10)`,
          [
            `COM-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`, c.client_id, c.client_name, subject, body,
            [canEmail ? c.email : null, canSms ? c.phone : null].filter(Boolean).join(", "),
            actorEmail, anySent ? "Sent" : "Failed", dedupKey, providerMessageId,
          ]
        );
        if (anySent) sent++; else skipped++;
      }
    } catch {
      skipped++;
    }
  }

  if (sent > 0 || skipped > 0) {
    await logAudit("Clients", "COMPLIANCE_REMINDER_SWEEP", "Firm", "", "", "", `Compliance deadline reminder sweep: ${sent} sent, ${skipped} skipped, by ${actorEmail}.`, actorEmail);
  }
  return { sent, skipped };
}
