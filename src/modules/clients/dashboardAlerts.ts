import crypto from "crypto";
import { query, queryOne } from "../../config/db";
import { sendChannel } from "../../common/sendChannel";
import { getFirmProfile } from "../../common/firmProfile";
import type { CandidateFinding } from "./swotFindingsEngine";

/**
 * Firm-wide on/off switch + thresholds for the Red-alert push below. Same
 * singleton-settings shape as v3_payroll_agent_settings/
 * v3_task_rules_agent_settings — one row, id='DASHALERT-1'.
 */
export interface DashboardAlertSettings {
  autoAlertsEnabled: boolean; cashThreshold: number; overdueDaysThreshold: number; filingDeadlineDaysThreshold: number;
  updatedBy: string | null; updatedAt: string | null;
}

export async function getDashboardAlertSettings(): Promise<DashboardAlertSettings> {
  const row = await queryOne<any>(`SELECT * FROM altax.v3_dashboard_alert_settings WHERE id = 'DASHALERT-1'`);
  return {
    autoAlertsEnabled: row ? row.auto_alerts_enabled !== false : true,
    cashThreshold: row ? Number(row.cash_threshold) : 0,
    overdueDaysThreshold: row ? Number(row.overdue_days_threshold) : 90,
    filingDeadlineDaysThreshold: row ? Number(row.filing_deadline_days_threshold) : 7,
    updatedBy: row?.updated_by || null, updatedAt: row?.updated_at || null,
  };
}

export async function updateDashboardAlertSettings(
  fields: Partial<{ autoAlertsEnabled: boolean; cashThreshold: number; overdueDaysThreshold: number; filingDeadlineDaysThreshold: number }>,
  actorEmail: string
): Promise<void> {
  await query(
    `UPDATE altax.v3_dashboard_alert_settings SET
       auto_alerts_enabled = COALESCE($1, auto_alerts_enabled),
       cash_threshold = COALESCE($2, cash_threshold),
       overdue_days_threshold = COALESCE($3, overdue_days_threshold),
       filing_deadline_days_threshold = COALESCE($4, filing_deadline_days_threshold),
       updated_by = $5, updated_at = now()
     WHERE id = 'DASHALERT-1'`,
    [
      fields.autoAlertsEnabled === undefined ? null : fields.autoAlertsEnabled,
      fields.cashThreshold === undefined ? null : fields.cashThreshold,
      fields.overdueDaysThreshold === undefined ? null : fields.overdueDaysThreshold,
      fields.filingDeadlineDaysThreshold === undefined ? null : fields.filingDeadlineDaysThreshold,
      actorEmail,
    ]
  );
}

export interface CreatedFindingInfo extends CandidateFinding {
  findingId: string;
  clientId: string;
  clientName: string;
}

/**
 * Which newly-created findings are genuinely push-worthy — deliberately a
 * narrow allow-list, not "every Urgent finding." net_loss and thin_margin
 * are Urgent/High priority too (worth surfacing on the dashboard), but a
 * persistent margin problem isn't a "drop everything" SMS the way a
 * negative cash balance, a receivable over the overdue threshold, or an
 * imminent unpaid filing deadline is. GL out-of-balance — the plan's 4th
 * candidate condition — is deliberately NOT duplicated here: the existing
 * Firm digest (runReminders, reminders.routes.ts) already checks and
 * reports every client's books-health nightly to every admin, so a second
 * alert for the same condition would just be noise.
 */
const ALERT_TRIGGER_PREFIXES = ["cash_balance_negative", "overdue_ar:", "filing_deadline_soon:"];

function alertWorthy(f: CandidateFinding): boolean {
  return f.priority === "Urgent" && ALERT_TRIGGER_PREFIXES.some((p) => f.autoTriggerKey.startsWith(p));
}

async function alreadyAlerted(findingId: string): Promise<boolean> {
  const row = await queryOne<any>(`SELECT 1 FROM altax.v3_communications WHERE source_system = 'DashboardAlerts' AND source_record_id = $1`, [findingId]);
  return !!row;
}

function idSuffix(): string {
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${ts}-${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
}

/** Assigned staff for this client if one resolves to a real active user; every active admin otherwise — mirrors the "unassigned work is everyone's" pattern already used for firm-wide digests. */
async function resolveClientAlertRecipients(assignedTo: string | null): Promise<{ email: string; phone: string | null }[]> {
  if (assignedTo) {
    const row = await queryOne<any>(
      `SELECT email, phone FROM altax.v3_users WHERE active = true AND (lower(email) = lower($1) OR lower(name) = lower($1) OR lower(user_id) = lower($1)) LIMIT 1`,
      [assignedTo]
    );
    if (row?.email) return [{ email: row.email, phone: row.phone || null }];
  }
  const admins = await query<any>(`SELECT email, phone FROM altax.v3_users WHERE active = true AND lower(role) = 'admin' AND email IS NOT NULL AND email <> ''`);
  return admins.map((a: any) => ({ email: a.email, phone: a.phone || null }));
}

/**
 * Pushes an email (and SMS, if the recipient has a phone on file) for every
 * newly-created finding that qualifies (see alertWorthy above). Idempotent
 * per finding_id — a finding is only ever "newly created" once during the
 * sweep that creates it, and this is checked again here as a belt-and-
 * suspenders guard, so this can never double-send for the same condition.
 * No-ops entirely (returns pushed: 0) when auto_alerts_enabled is off.
 */
export async function runDashboardAlertPush(createdFindings: CreatedFindingInfo[], actorEmail: string): Promise<{ pushed: number; skipped: number }> {
  const settings = await getDashboardAlertSettings();
  if (!settings.autoAlertsEnabled) return { pushed: 0, skipped: createdFindings.length };

  const worthy = createdFindings.filter(alertWorthy);
  let pushed = 0;
  let skipped = createdFindings.length - worthy.length;
  if (worthy.length === 0) return { pushed, skipped };

  const firmName = (await getFirmProfile()).firmName;

  for (const f of worthy) {
    if (await alreadyAlerted(f.findingId)) { skipped++; continue; }

    const clientRow = await queryOne<any>(`SELECT assigned_to FROM altax.v3_clients WHERE client_id = $1`, [f.clientId]);
    const recipients = await resolveClientAlertRecipients(clientRow?.assigned_to || null);
    if (recipients.length === 0) { skipped++; continue; }

    const subject = `[Urgent] ${f.clientName}: ${f.findingText}`;
    const body = `${f.findingText}\n\n${f.supportingData}\n\nRecommended action: ${f.recommendedAction}\n\nSee the client's At a Glance dashboard and SWOT Analysis tab for full context.`;

    let anySent = false;
    // This row summarizes a fan-out to potentially several recipients across
    // email+SMS, so it can only carry one provider id — the first successful
    // send's, matched against whichever channel actually delivers first.
    let providerMessageId: string | null = null;
    for (const r of recipients) {
      const emailResult = await sendChannel("email", r.email, subject, body, { firmName });
      if (emailResult.sent) { anySent = true; providerMessageId = providerMessageId || emailResult.providerMessageId || null; }
      if (r.phone) {
        const smsResult = await sendChannel("sms", r.phone, subject, `${f.clientName}: ${f.findingText} ${f.recommendedAction}`, { firmName });
        if (smsResult.sent) { anySent = true; providerMessageId = providerMessageId || smsResult.providerMessageId || null; }
      }
    }

    await query(
      `INSERT INTO altax.v3_communications
         (communication_id, client_id, client_name, related_task_id, subject, message_english, message_arabic,
          sent_to, sent_by, direction, channel, sent_at, status, source_system, source_record_id, provider_message_id)
       VALUES ($1,$2,$3,NULL,$4,$5,'',$6,$7,'Outbound','Email',now(),$8,'DashboardAlerts',$9,$10)`,
      [
        `COM-${idSuffix()}`, f.clientId, f.clientName, subject, body,
        recipients.map((r) => r.email).join(", "), actorEmail, anySent ? "Sent" : "Failed", f.findingId, providerMessageId,
      ]
    );
    if (anySent) pushed++; else skipped++;
  }

  return { pushed, skipped };
}
