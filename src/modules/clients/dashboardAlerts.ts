import crypto from "crypto";
import { query, queryOne } from "../../config/db";
import { sendChannel } from "../../common/sendChannel";
import { getFirmProfile } from "../../common/firmProfile";
import type { CandidateFinding } from "./swotFindingsEngine";
import { escapeHtml } from "../../common/html";

/**
 * Firm-wide on/off switch + thresholds for the Red-alert push below. Same
 * singleton-settings shape as v3_payroll_agent_settings/
 * v3_task_rules_agent_settings — one row, id='DASHALERT-1'.
 */
export interface DashboardAlertSettings {
  autoAlertsEnabled: boolean; cashThreshold: number; overdueDaysThreshold: number; filingDeadlineDaysThreshold: number;
  /** Grace period (days) added on top of a payroll-enabled client's own pay
   * frequency before PayrollCadenceGap fires — see complianceGapFlags.ts. */
  payrollCadenceGraceDays: number;
  /** Days since a client's last GL entry, past which BookkeepingStale fires
   * — real production data set this default deliberately high (75, not a
   * round-number guess) since the firm's whole client base normally lags
   * ~48 days behind on posting; see complianceGapFlags.ts's own comment. */
  bookkeepingStalenessDaysThreshold: number;
  updatedBy: string | null; updatedAt: string | null;
}

// PERF-015 (Hard Audit, 2026-08-13) — assembleSwotEngineInput calls this once
// per client inside the nightly SWOT sweep (runSwotFindingsSweep), but this
// is one firm-wide settings row, identical on every call within a sweep run.
// Same short TTL-cache shape as reports.routes.ts's ensureCoaTypeCache — a
// live edit to these settings still takes effect within 30s, no cache-bust
// wiring needed on the PATCH route.
let cachedSettings: DashboardAlertSettings | null = null;
let cachedSettingsAt = 0;
const DASHBOARD_ALERT_SETTINGS_CACHE_TTL_MS = 30_000;

export async function getDashboardAlertSettings(): Promise<DashboardAlertSettings> {
  if (cachedSettings && Date.now() - cachedSettingsAt < DASHBOARD_ALERT_SETTINGS_CACHE_TTL_MS) return cachedSettings;
  const row = await queryOne<any>(`SELECT * FROM altax.v3_dashboard_alert_settings WHERE id = 'DASHALERT-1'`);
  cachedSettings = {
    autoAlertsEnabled: row ? row.auto_alerts_enabled !== false : true,
    cashThreshold: row ? Number(row.cash_threshold) : 0,
    overdueDaysThreshold: row ? Number(row.overdue_days_threshold) : 90,
    filingDeadlineDaysThreshold: row ? Number(row.filing_deadline_days_threshold) : 7,
    payrollCadenceGraceDays: row?.payroll_cadence_grace_days != null ? Number(row.payroll_cadence_grace_days) : 10,
    bookkeepingStalenessDaysThreshold: row?.bookkeeping_staleness_days_threshold != null ? Number(row.bookkeeping_staleness_days_threshold) : 75,
    updatedBy: row?.updated_by || null, updatedAt: row?.updated_at || null,
  };
  cachedSettingsAt = Date.now();
  return cachedSettings;
}

export async function updateDashboardAlertSettings(
  fields: Partial<{
    autoAlertsEnabled: boolean; cashThreshold: number; overdueDaysThreshold: number; filingDeadlineDaysThreshold: number;
    payrollCadenceGraceDays: number; bookkeepingStalenessDaysThreshold: number;
  }>,
  actorEmail: string
): Promise<void> {
  await query(
    `UPDATE altax.v3_dashboard_alert_settings SET
       auto_alerts_enabled = COALESCE($1, auto_alerts_enabled),
       cash_threshold = COALESCE($2, cash_threshold),
       overdue_days_threshold = COALESCE($3, overdue_days_threshold),
       filing_deadline_days_threshold = COALESCE($4, filing_deadline_days_threshold),
       payroll_cadence_grace_days = COALESCE($5, payroll_cadence_grace_days),
       bookkeeping_staleness_days_threshold = COALESCE($6, bookkeeping_staleness_days_threshold),
       updated_by = $7, updated_at = now()
     WHERE id = 'DASHALERT-1'`,
    [
      fields.autoAlertsEnabled === undefined ? null : fields.autoAlertsEnabled,
      fields.cashThreshold === undefined ? null : fields.cashThreshold,
      fields.overdueDaysThreshold === undefined ? null : fields.overdueDaysThreshold,
      fields.filingDeadlineDaysThreshold === undefined ? null : fields.filingDeadlineDaysThreshold,
      fields.payrollCadenceGraceDays === undefined ? null : fields.payrollCadenceGraceDays,
      fields.bookkeepingStalenessDaysThreshold === undefined ? null : fields.bookkeepingStalenessDaysThreshold,
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
 * Pushes ONE email (and SMS, if the recipient has a phone on file) per
 * recipient per sweep, covering every newly-created finding that qualifies
 * (see alertWorthy above) and is addressed to them — instead of one
 * email per finding, which used to flood a staffer with N separate
 * "[Urgent]" emails when N clients tripped an alert-worthy condition the
 * same night. A recipient who's the assigned staff for 2 alert-worthy
 * clients tonight and also an admin (so picks up unassigned findings too)
 * still gets exactly one combined email.
 *
 * Idempotent per finding_id — a finding is only ever "newly created" once
 * during the sweep that creates it, and this is checked again here as a
 * belt-and-suspenders guard, so this can never double-send for the same
 * condition. Still writes ONE v3_communications row per underlying finding
 * (so per-finding audit history and the alreadyAlerted() dedup check keep
 * working exactly as before) even though the actual send is now batched —
 * every row produced by the same recipient's batch send shares that send's
 * provider_message_id, mirroring the "one send, multiple logical records"
 * pattern this file already used for a single finding fanned out to
 * multiple recipients.
 *
 * No-ops entirely (returns pushed: 0) when auto_alerts_enabled is off.
 */
export async function runDashboardAlertPush(createdFindings: CreatedFindingInfo[], actorEmail: string): Promise<{ pushed: number; skipped: number }> {
  const settings = await getDashboardAlertSettings();
  if (!settings.autoAlertsEnabled) return { pushed: 0, skipped: createdFindings.length };

  const worthy = createdFindings.filter(alertWorthy);
  let skipped = createdFindings.length - worthy.length;
  if (worthy.length === 0) return { pushed: 0, skipped };

  const firmName = (await getFirmProfile()).firmName;

  // Resolve recipients per finding up front — unchanged logic from the old
  // one-email-per-finding version (assigned staff, or every admin when
  // unassigned) and the same alreadyAlerted() idempotency guard. Only the
  // send step below changes.
  const pending: { finding: CreatedFindingInfo; recipients: { email: string; phone: string | null }[] }[] = [];
  for (const f of worthy) {
    if (await alreadyAlerted(f.findingId)) { skipped++; continue; }
    const clientRow = await queryOne<any>(`SELECT assigned_to FROM altax.v3_clients WHERE client_id = $1`, [f.clientId]);
    const recipients = await resolveClientAlertRecipients(clientRow?.assigned_to || null);
    if (recipients.length === 0) { skipped++; continue; }
    pending.push({ finding: f, recipients });
  }
  if (pending.length === 0) return { pushed: 0, skipped };

  // Group by recipient email so a recipient due N findings tonight gets ONE
  // email listing all N, not N separate emails.
  const byRecipient = new Map<string, { phone: string | null; findings: CreatedFindingInfo[] }>();
  for (const p of pending) {
    for (const r of p.recipients) {
      const key = r.email.toLowerCase();
      let entry = byRecipient.get(key);
      if (!entry) { entry = { phone: r.phone, findings: [] }; byRecipient.set(key, entry); }
      else if (!entry.phone && r.phone) entry.phone = r.phone;
      entry.findings.push(p.finding);
    }
  }

  // One actual send per recipient, covering their whole batch. The email
  // body lists every finding (client name at the top of each entry — see
  // the bug this replaced: the client name used to only ever appear in the
  // subject line, never the body). SMS stays short: a count plus the single
  // most urgent item when there's more than one, matching how this app's
  // other SMS sends (sendChannel's own long-body collapse) keep texts brief
  // rather than cramming a full multi-item list into one message.
  const recipientResults = new Map<string, { subject: string; body: string; sent: boolean; providerMessageId: string | null }>();
  for (const [email, group] of byRecipient) {
    const n = group.findings.length;
    const subject = `[Urgent] Daily Alert — ${n} item${n === 1 ? "" : "s"} need${n === 1 ? "s" : ""} attention`;
    const body = group.findings
      .map((f, i) => `${i + 1}. Client: ${f.clientName}\n${f.findingText}\n\n${f.supportingData}\n\nRecommended action: ${f.recommendedAction}`)
      .join("\n\n---\n\n")
      + `\n\nSee each client's At a Glance dashboard and SWOT Analysis tab for full context.`;

    let sent = false;
    let providerMessageId: string | null = null;
    // Escaped only for the email HTML render — `body` itself stays plain,
    // since it's also what recipientResults stores for the v3_communications log below.
    const emailResult = await sendChannel("email", email, subject, escapeHtml(body), { firmName });
    if (emailResult.sent) { sent = true; providerMessageId = emailResult.providerMessageId || null; }
    if (group.phone) {
      const smsBody = n === 1
        ? `${group.findings[0].clientName}: ${group.findings[0].findingText} ${group.findings[0].recommendedAction}`
        : `${n} urgent items need your attention today, including ${group.findings[0].clientName}: ${group.findings[0].findingText} See your email for the full list.`;
      const smsResult = await sendChannel("sms", group.phone, subject, smsBody, { firmName });
      if (smsResult.sent) { sent = true; providerMessageId = providerMessageId || smsResult.providerMessageId || null; }
    }
    recipientResults.set(email, { subject, body, sent, providerMessageId });
  }

  // One v3_communications row per underlying finding, preserving the
  // existing per-finding source_record_id dedup key even though the actual
  // send was a shared batch email per recipient.
  let pushed = 0;
  for (const p of pending) {
    const emails = p.recipients.map((r) => r.email);
    const results = emails.map((e) => recipientResults.get(e.toLowerCase())).filter((r): r is NonNullable<typeof r> => !!r);
    const successResult = results.find((r) => r.sent) || results[0];
    const anySent = results.some((r) => r.sent);

    await query(
      `INSERT INTO altax.v3_communications
         (communication_id, client_id, client_name, related_task_id, subject, message_english, message_arabic,
          sent_to, sent_by, direction, channel, sent_at, status, source_system, source_record_id, provider_message_id)
       VALUES ($1,$2,$3,NULL,$4,$5,'',$6,$7,'Outbound','Email',now(),$8,'DashboardAlerts',$9,$10)`,
      [
        `COM-${idSuffix()}`, p.finding.clientId, p.finding.clientName, successResult?.subject || "", successResult?.body || "",
        emails.join(", "), actorEmail, anySent ? "Sent" : "Failed", p.finding.findingId, successResult?.providerMessageId || null,
      ]
    );
    if (anySent) pushed++; else skipped++;
  }

  return { pushed, skipped };
}
