/**
 * Shared client-facing email templates for the filing/payment confirmation +
 * reminder system (Save & Send across MD Sales Tax, obligation-completion
 * deposits like EFTPS, and task-tracked agency filings). Visual shape copied
 * directly from paymentReceiptEmailHtml (billing.routes.ts) — same bilingual
 * EN/AR label/value row table inside wrapEmailHtml — so this reads as part of
 * the same system, not a bolted-on extra.
 *
 * Both send functions here own the consent check and the v3_communications
 * log write, matching runClientMdSalesTaxDeadlineNotifications's pattern
 * (clients.routes.ts) — centralized once so every caller (MD filing routes,
 * obligation-completion routes, task routes, the reminder cron) doesn't have
 * to repeat consent gating or dedup logging itself.
 */
import { Request } from "express";
import crypto from "crypto";
import { query } from "../config/db";
import { wrapEmailHtml } from "./emailTemplate";
import { sendEmail, sendSms, recordNotificationFailure } from "./notifications";
import { buildGoogleCalendarUrl, buildAddToCalendarButtonHtml } from "./calendarLinks";

function idSuffix(): string {
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${ts}-${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
}

function esc(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function fmtDate(v: string | Date | null): string {
  if (!v) return "—";
  // A DATE column comes back from `SELECT *` as a JS Date — String(date) shifts
  // UTC midnight back a day in local time, so it must go through toISOString()
  // rather than straight into a "YYYY-MM-DDT..." string.
  const raw = v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
  const d = new Date(`${raw}T00:00:00Z`);
  // Matches the public report pages' own date format exactly (PublicMdFilingPage etc.'s
  // fmtDate) — a client reading "Jul 1, 2026" in the email and clicking through to a page
  // that also says "Jul 1, 2026" shouldn't have to reconcile two different date styles.
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}
/** Formats a period start/end pair the same way every public report page does ("Jul 1 – Jul 31, 2026"), for callers (MD Sales Tax) that build their own periodLabel from raw ISO dates instead of a pre-formatted quarter/year string. */
export function fmtPeriodRange(start: string, end: string): string {
  return `${fmtDate(start)} – ${fmtDate(end)}`;
}
function money2(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function row(label: string, labelAr: string, value: string, boldValue = false): string {
  return `
    <tr>
      <td style="padding:6px 0; color:#6b7280; font-size:13px;">${label} <bdi dir="rtl" style="color:#9ca3af;">/ ${labelAr}</bdi></td>
      <td align="right" style="padding:6px 0; font-size:13px; ${boldValue ? "font-weight:700; font-size:15px;" : ""}">${value}</td>
    </tr>`;
}

/**
 * A real English block followed by a real Arabic block — each with its own
 * `dir`/`text-align`, not one line of English with a muted "/ Arabic" phrase
 * tacked onto the end. Same pattern portalInviteEmailHtml already uses;
 * applied here too so the two don't read as two different design languages.
 */
function bilingualParagraph(en: string, ar: string, opts: { color?: string; marginBottom?: number } = {}): string {
  const color = opts.color ?? "#1a1a1a";
  const mb = opts.marginBottom ?? 18;
  return `
    <div dir="ltr" style="text-align:left; margin:0 0 4px; color:${color};">${en}</div>
    <div dir="rtl" style="text-align:right; margin:0 0 ${mb}px; color:${color};">${ar}</div>`;
}

/** A single button carrying both languages on one line ("Label · التسمية"), matching the convention every appointment email button already uses — rather than an English-only button with no Arabic anywhere near it. */
function bilingualButtonHtml(url: string, enLabel: string, arLabel: string, color = "#0f766e"): string {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 18px;">
      <tr><td style="border-radius:6px; background:${color};">
        <a href="${esc(url)}" style="display:inline-block; padding:12px 24px; color:#fff; font-size:13.5px; font-weight:600; text-decoration:none; text-align:center;">
          ${esc(enLabel)} &nbsp;·&nbsp; <bdi dir="rtl">${esc(arLabel)}</bdi>
        </a>
      </td></tr>
    </table>`;
}

/**
 * Guards against ever emailing a client a dead link — the same defensive
 * check wrapEmailHtml already applies to the logo image, extended here to
 * the acknowledge button. A request made against a local dev server (e.g.
 * testing via curl/Postman directly, rather than through the deployed app)
 * resolves publicBaseUrl(req) to http://localhost:xxxx, which is real and
 * "correct" for that request but unreachable from anyone else's phone or
 * inbox — better to omit the button than send a link that can only ever
 * 404/timeout for the person receiving it.
 */
function isPubliclyReachable(url: string | undefined): url is string {
  return Boolean(url) && /^https?:\/\//i.test(url!) && !/localhost|127\.0\.0\.1/i.test(url!);
}

export interface FilingClientInfo {
  clientId: string;
  clientName: string;
  email: string | null;
  emailAllowed: boolean;
  phone?: string | null;
  smsAllowed?: boolean;
}

async function logFilingCommunication(
  sourceSystem: string, sourceRecordId: string, client: FilingClientInfo, subject: string, bodyText: string, sentTo: string, status: "Sent" | "Failed", channel: "Email" | "SMS" = "Email"
): Promise<void> {
  await query(
    `INSERT INTO altax.v3_communications
       (communication_id, client_id, client_name, related_task_id, subject, message_english, message_arabic,
        sent_to, sent_by, direction, channel, sent_at, status, source_system, source_record_id, provider_message_id)
     VALUES ($1,$2,$3,NULL,$4,$5,'',$6,$7,'Outbound',$8,now(),$9,$10,$11,NULL)`,
    [`COM-${idSuffix()}`, client.clientId, client.clientName, subject, bodyText, sentTo, "System", channel, status, sourceSystem, sourceRecordId]
  );
}

/**
 * SMS companion to the email confirmation — same "we filed this" fact and
 * amount, condensed to one line, since SMS can't carry the full breakdown
 * table (see communications.routes.ts's own SMS_INLINE_MAX_CHARS collapse
 * for the same reasoning). Reuses the same acknowledgeUrl the email button
 * uses — one link, two channels, no separate short-link system needed.
 */
async function sendFilingSms(opts: {
  client: FilingClientInfo; sourceSystem: string; sourceRecordId: string;
  filingType: string; periodLabel: string | null; amountLabel: string; amount: number; acknowledgeUrl?: string;
}): Promise<{ sent: boolean }> {
  if (!opts.client.smsAllowed || !opts.client.phone) return { sent: false };
  const period = opts.periodLabel ? ` for ${opts.periodLabel}` : "";
  const link = isPubliclyReachable(opts.acknowledgeUrl) ? ` View: ${opts.acknowledgeUrl}` : "";
  const body = `AL TAX SERVICE: Filed your ${opts.filingType}${period}. ${opts.amountLabel}: ${money2(opts.amount)}.${link}`;
  try {
    await sendSms({ to: opts.client.phone, body });
    await logFilingCommunication(opts.sourceSystem, opts.sourceRecordId, opts.client, `Filing Confirmation — ${opts.filingType}`, body, opts.client.phone, "Sent", "SMS");
    return { sent: true };
  } catch (err) {
    await recordNotificationFailure(`${opts.sourceSystem.toLowerCase()}Sms:${opts.sourceRecordId}`, err);
    await logFilingCommunication(opts.sourceSystem, opts.sourceRecordId, opts.client, `Filing Confirmation — ${opts.filingType}`, body, opts.client.phone, "Failed", "SMS");
    return { sent: false };
  }
}

export interface FilingConfirmationBreakdownRow {
  label: string;
  labelAr: string;
  valueStr: string;
}

export interface FilingConfirmationInput {
  client: FilingClientInfo;
  sourceRecordId: string; // same key used for the v3_payment_reminders row this filing schedules, if any
  filingType: string;
  periodLabel: string | null;
  filedDate: string;
  amount: number;
  /** Overrides the hero card's label — defaults to "Amount", but a type whose own report page calls this number something more specific ("Tax Due", "Balance Due") should say the same thing here, so the email and the page it links to read as one number, not two. */
  amountLabel?: string;
  amountLabelAr?: string;
  /** Optional line items shown between Period and Filed Date — e.g. Form 941's Gross Liability / EFTPS Deposits Applied, the two numbers that produce the hero's Balance Due. Pre-formatted strings (via money2 or a "−" prefix), same convention the report pages use for a subtracted line. */
  breakdown?: FilingConfirmationBreakdownRow[];
  paymentDueDate: string;
  paidDate: string | null;
  acknowledgeUrl?: string;
  req?: Request;
}

/** Body used both as the email HTML and (plain-text-ish) as the v3_communications log entry. */
function filingConfirmationBody(input: FilingConfirmationInput): string {
  const canAcknowledge = isPubliclyReachable(input.acknowledgeUrl);
  const amountLabel = input.amountLabel ?? "Amount";
  const amountLabelAr = input.amountLabelAr ?? "المبلغ";
  return `
    ${bilingualParagraph(
      `This is a confirmation that we filed your <strong>${esc(input.filingType)}</strong>${input.periodLabel ? ` for the period <strong>${esc(input.periodLabel)}</strong>` : ""}.`,
      `هذا تأكيد بأننا قدّمنا <strong>${esc(input.filingType)}</strong>${input.periodLabel ? ` الخاص بكم عن الفترة <strong>${esc(input.periodLabel)}</strong>` : ""}.`
    )}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-radius:10px; overflow:hidden; margin:0 0 18px; border:1px solid #e5e7eb;">
      <tr><td style="background:#0f2d3e; padding:16px 18px;">
        <div style="color:#9fb4bf; font-size:11px; font-weight:700; letter-spacing:0.06em; text-transform:uppercase;">
          ${esc(amountLabel)} &nbsp;/&nbsp; <bdi dir="rtl">${esc(amountLabelAr)}</bdi>
        </div>
        <div style="color:#ffffff; font-size:28px; font-weight:800; margin-top:2px;">${money2(input.amount)}</div>
      </td></tr>
      <tr><td style="background:#f8fafb; padding:14px 18px 4px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          ${row("Filing Type", "نوع الإقرار", esc(input.filingType))}
          ${input.periodLabel ? row("Period", "الفترة", esc(input.periodLabel)) : ""}
          ${input.breakdown?.length ? `<tr><td colspan="2" style="padding:6px 0 0; border-top:1px solid #e5e7eb;"></td></tr>` : ""}
          ${(input.breakdown ?? []).map((b) => row(b.label, b.labelAr, esc(b.valueStr))).join("")}
          <tr><td colspan="2" style="padding:6px 0 0; border-top:1px solid #e5e7eb;"></td></tr>
          ${row("Filed Date", "تاريخ التقديم", fmtDate(input.filedDate))}
          ${input.paidDate ? row("Payment Date", "تاريخ الدفع", fmtDate(input.paidDate)) : row("Payment Due Date", "تاريخ استحقاق الدفع", fmtDate(input.paymentDueDate))}
        </table>
      </td></tr>
    </table>
    ${canAcknowledge ? bilingualButtonHtml(input.acknowledgeUrl!, "View & Acknowledge Report", "عرض الإقرار وتأكيد الاستلام") : ""}
    ${bilingualParagraph(
      input.paidDate ? "This filing is paid in full." : "We'll send a reminder before the payment due date above. If you have any questions, just reply to this email.",
      input.paidDate ? "تم دفع هذا الإقرار بالكامل." : "سنرسل تذكيراً قبل تاريخ استحقاق الدفع أعلاه. إذا كانت لديكم أي أسئلة، فقط قوموا بالرد على هذا البريد الإلكتروني.",
      { color: "#6b7280", marginBottom: 0 }
    )}`;
}

/** Sends the immediate "we filed this" confirmation over every channel the client is opted into — email (full breakdown) and SMS (one-line summary + the same link) independently, so an SMS-only or email-only client still gets notified instead of silently getting nothing. */
export async function sendFilingConfirmation(input: FilingConfirmationInput): Promise<{ sent: boolean }> {
  let emailSent = false;
  if (input.client.emailAllowed && input.client.email) {
    const subject = `Filing Confirmation — ${input.filingType}${input.periodLabel ? ` (${input.periodLabel})` : ""}`;
    const body = filingConfirmationBody(input);
    try {
      const html = await wrapEmailHtml(body, input.req);
      await sendEmail({ to: input.client.email, subject, html });
      await logFilingCommunication("FilingConfirmation", input.sourceRecordId, input.client, subject, body, input.client.email, "Sent");
      emailSent = true;
    } catch (err) {
      await recordNotificationFailure(`filingConfirmation:${input.sourceRecordId}`, err);
      await logFilingCommunication("FilingConfirmation", input.sourceRecordId, input.client, subject, body, input.client.email, "Failed");
    }
  }
  const { sent: smsSent } = await sendFilingSms({
    client: input.client, sourceSystem: "FilingConfirmation", sourceRecordId: input.sourceRecordId,
    filingType: input.filingType, periodLabel: input.periodLabel, amountLabel: input.amountLabel ?? "Amount", amount: input.amount, acknowledgeUrl: input.acknowledgeUrl,
  });
  return { sent: emailSent || smsSent };
}

export interface PaymentDueReminderInput {
  client: FilingClientInfo;
  sourceRecordId: string;
  filingType: string;
  periodLabel: string | null;
  amount: number;
  paymentDueDate: string;
  req?: Request;
}

function paymentDueReminderBody(input: PaymentDueReminderInput): string {
  return `
    ${bilingualParagraph(
      `Reminder — your payment for <strong>${esc(input.filingType)}</strong>${input.periodLabel ? ` (${esc(input.periodLabel)})` : ""} is coming up.`,
      `تذكير — موعد دفعة <strong>${esc(input.filingType)}</strong>${input.periodLabel ? ` (${esc(input.periodLabel)})` : ""} يقترب.`
    )}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
           style="background:#f8fafb; border:1px solid #e5e7eb; border-left:3px solid #b45309; border-radius:6px; margin:0 0 18px;">
      <tr><td style="padding:14px 18px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          ${row("Filing Type", "نوع الإقرار", esc(input.filingType))}
          ${input.periodLabel ? row("Period", "الفترة", esc(input.periodLabel)) : ""}
          ${row("Amount Due", "المبلغ المستحق", money2(input.amount), true)}
          ${row("Due Date", "تاريخ الاستحقاق", fmtDate(input.paymentDueDate), true)}
        </table>
      </td></tr>
    </table>
    ${bilingualParagraph(
      "If this has already been paid, please disregard this message.",
      "إذا كان قد تم دفع هذا المبلغ بالفعل، يرجى تجاهل هذه الرسالة.",
      { color: "#6b7280", marginBottom: 0 }
    )}`;
}

/** Sends the 9AM-ET-day-before payment-due reminder over every channel the client is opted into. Same consent gating and logging convention as sendFilingConfirmation. */
export async function sendPaymentDueReminder(input: PaymentDueReminderInput): Promise<{ sent: boolean }> {
  let emailSent = false;
  if (input.client.emailAllowed && input.client.email) {
    const subject = `Reminder: Payment Due Soon — ${input.filingType}${input.periodLabel ? ` (${input.periodLabel})` : ""}`;
    const body = paymentDueReminderBody(input);
    try {
      const html = await wrapEmailHtml(body, input.req);
      await sendEmail({ to: input.client.email, subject, html });
      await logFilingCommunication("PaymentDueReminder", input.sourceRecordId, input.client, subject, body, input.client.email, "Sent");
      emailSent = true;
    } catch (err) {
      await recordNotificationFailure(`paymentDueReminder:${input.sourceRecordId}`, err);
      await logFilingCommunication("PaymentDueReminder", input.sourceRecordId, input.client, subject, body, input.client.email, "Failed");
    }
  }
  const { sent: smsSent } = await (async () => {
    if (!input.client.smsAllowed || !input.client.phone) return { sent: false };
    const period = input.periodLabel ? ` (${input.periodLabel})` : "";
    const body = `AL TAX SERVICE: Reminder — your payment for ${input.filingType}${period} of ${money2(input.amount)} is due ${fmtDate(input.paymentDueDate)}.`;
    try {
      await sendSms({ to: input.client.phone, body });
      await logFilingCommunication("PaymentDueReminder", input.sourceRecordId, input.client, `Reminder: Payment Due Soon — ${input.filingType}`, body, input.client.phone, "Sent", "SMS");
      return { sent: true };
    } catch (err) {
      await recordNotificationFailure(`paymentDueReminderSms:${input.sourceRecordId}`, err);
      await logFilingCommunication("PaymentDueReminder", input.sourceRecordId, input.client, `Reminder: Payment Due Soon — ${input.filingType}`, body, input.client.phone, "Failed", "SMS");
      return { sent: false };
    }
  })();
  return { sent: emailSent || smsSent };
}

export interface EftpsEmployeeLine {
  employeeName: string;
  federalIncomeTax: number;
  socialSecurity: number;
  medicare: number;
  subtotal: number;
}

export interface EftpsDepositReportInput {
  client: FilingClientInfo;
  sourceRecordId: string;
  periodLabel: string;
  filingDate: string;
  paymentDate: string;
  dueDate: string;
  federalIncomeTaxTotal: number;
  socialSecurityTotal: number;
  medicareTotal: number;
  totalAmount: number;
  employees: EftpsEmployeeLine[];
  acknowledgeUrl: string;
  req?: Request;
}

/**
 * Federal-only, by design — deliberately never includes State withholding or
 * Unemployment Insurance (direct owner instruction, 2026-08-29): this report
 * confirms the EFTPS federal deposit specifically, not the client's full
 * payroll tax picture, which is a separate quarterly report.
 */
function eftpsDepositReportBody(input: EftpsDepositReportInput): string {
  const dueDateObj = new Date(`${String(input.dueDate).slice(0, 10)}T00:00:00Z`);
  const nextDay = new Date(dueDateObj.getTime() + 24 * 60 * 60 * 1000);
  const googleCalendarUrl = Number.isNaN(dueDateObj.getTime()) ? null : buildGoogleCalendarUrl({
    uid: `eftps-${input.sourceRecordId}`,
    title: `EFTPS Federal Tax Deposit Due — ${input.client.clientName}`,
    startISO: dueDateObj.toISOString(),
    endISO: nextDay.toISOString(),
    description: `Federal tax deposit of ${money2(input.totalAmount)} due for ${input.periodLabel}. Pay on EFTPS's website.`,
  });

  const employeeRows = input.employees
    .map(
      (e) => `
        <tr>
          <td style="padding:5px 8px; font-size:12.5px; border-bottom:1px solid #e5e7eb;">${esc(e.employeeName)}</td>
          <td align="right" style="padding:5px 8px; font-size:12.5px; border-bottom:1px solid #e5e7eb;">${money2(e.federalIncomeTax)}</td>
          <td align="right" style="padding:5px 8px; font-size:12.5px; border-bottom:1px solid #e5e7eb;">${money2(e.socialSecurity)}</td>
          <td align="right" style="padding:5px 8px; font-size:12.5px; border-bottom:1px solid #e5e7eb;">${money2(e.medicare)}</td>
          <td align="right" style="padding:5px 8px; font-size:12.5px; font-weight:600; border-bottom:1px solid #e5e7eb;">${money2(e.subtotal)}</td>
        </tr>`
    )
    .join("");

  const canAcknowledge = isPubliclyReachable(input.acknowledgeUrl);
  return `
    ${bilingualParagraph(
      `This is a confirmation of your federal payroll tax deposit (EFTPS) for <strong>${esc(input.periodLabel)}</strong>.`,
      `هذا تأكيد لإيداع ضريبة الرواتب الفيدرالية (EFTPS) الخاص بكم عن الفترة <strong>${esc(input.periodLabel)}</strong>.`
    )}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-radius:10px; overflow:hidden; margin:0 0 18px; border:1px solid #e5e7eb;">
      <tr><td style="background:#0f2d3e; padding:16px 18px;">
        <div style="color:#9fb4bf; font-size:11px; font-weight:700; letter-spacing:0.06em; text-transform:uppercase;">
          Total Federal Deposit &nbsp;/&nbsp; <bdi dir="rtl">إجمالي الإيداع الفيدرالي</bdi>
        </div>
        <div style="color:#ffffff; font-size:28px; font-weight:800; margin-top:2px;">${money2(input.totalAmount)}</div>
      </td></tr>
      <tr><td style="background:#f8fafb; padding:14px 18px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          ${row("Period", "الفترة", esc(input.periodLabel))}
          ${row("Filed Date", "تاريخ التقديم", fmtDate(input.filingDate))}
          ${row("Due Date", "تاريخ الاستحقاق", fmtDate(input.dueDate))}
          ${row("Payment Date", "تاريخ الدفع", fmtDate(input.paymentDate))}
          ${row("Federal Income Tax", "ضريبة الدخل الفيدرالية", money2(input.federalIncomeTaxTotal))}
          ${row("Social Security", "الضمان الاجتماعي", money2(input.socialSecurityTotal))}
          ${row("Medicare", "الرعاية الطبية", money2(input.medicareTotal))}
        </table>
      </td></tr>
    </table>
    <p style="margin:0 0 8px; font-size:13px; font-weight:600; color:#374151;">By Employee &nbsp;/&nbsp; <bdi dir="rtl" style="color:#9ca3af; font-weight:400;">حسب الموظف</bdi></p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px; border:1px solid #e5e7eb; border-radius:6px; overflow:hidden;">
      <tr style="background:#f3f4f6;">
        <td style="padding:6px 8px; font-size:11.5px; color:#6b7280; text-transform:uppercase;">Employee</td>
        <td align="right" style="padding:6px 8px; font-size:11.5px; color:#6b7280; text-transform:uppercase;">Federal Income Tax</td>
        <td align="right" style="padding:6px 8px; font-size:11.5px; color:#6b7280; text-transform:uppercase;">Social Security</td>
        <td align="right" style="padding:6px 8px; font-size:11.5px; color:#6b7280; text-transform:uppercase;">Medicare</td>
        <td align="right" style="padding:6px 8px; font-size:11.5px; color:#6b7280; text-transform:uppercase;">Total</td>
      </tr>
      ${employeeRows}
    </table>
    ${canAcknowledge ? bilingualButtonHtml(input.acknowledgeUrl, "View & Acknowledge Report", "عرض الإقرار وتأكيد الاستلام").replace("margin:0 0 18px;", "margin:0 0 4px;") : ""}
    ${googleCalendarUrl ? buildAddToCalendarButtonHtml(googleCalendarUrl, { theme: "green" }).replace('margin-top:10px', 'margin:4px 0 18px; text-align:left') : ""}
    ${bilingualParagraph(
      "This report covers federal deposit amounts only — state withholding and unemployment insurance are covered separately in your quarterly payroll report.",
      "يغطي هذا التقرير مبالغ الإيداع الفيدرالي فقط — يتم تغطية الضريبة الحكومية المقتطعة وتأمين البطالة بشكل منفصل ضمن تقرير الرواتب الفصلي.",
      { color: "#6b7280", marginBottom: 0 }
    )}`;
}

/** Save & Send for the EFTPS deposit workflow — a real per-employee federal breakdown, not the single-amount shape sendFilingConfirmation uses elsewhere. Same consent gating and logging convention as the rest of this file, over every channel the client is opted into. */
export async function sendEftpsDepositReport(input: EftpsDepositReportInput): Promise<{ sent: boolean }> {
  let emailSent = false;
  if (input.client.emailAllowed && input.client.email) {
    const subject = `Federal Tax Deposit Report — ${input.periodLabel}`;
    const body = eftpsDepositReportBody(input);
    try {
      const html = await wrapEmailHtml(body, input.req);
      await sendEmail({ to: input.client.email, subject, html });
      await logFilingCommunication("EftpsDepositReport", input.sourceRecordId, input.client, subject, body, input.client.email, "Sent");
      emailSent = true;
    } catch (err) {
      await recordNotificationFailure(`eftpsDepositReport:${input.sourceRecordId}`, err);
      await logFilingCommunication("EftpsDepositReport", input.sourceRecordId, input.client, subject, body, input.client.email, "Failed");
    }
  }
  const { sent: smsSent } = await sendFilingSms({
    client: input.client, sourceSystem: "EftpsDepositReport", sourceRecordId: input.sourceRecordId,
    filingType: "Federal Tax Deposit (EFTPS)", periodLabel: input.periodLabel, amountLabel: "Total Deposit", amount: input.totalAmount, acknowledgeUrl: input.acknowledgeUrl,
  });
  return { sent: emailSent || smsSent };
}

export interface NoticeReceivedInput {
  client: FilingClientInfo;
  sourceRecordId: string;
  agency: string;
  noticeType: string;
  taxPeriod: string | null;
  amount: number | null;
  responseDeadline: string | null;
  req?: Request;
}

function noticeReceivedBody(input: NoticeReceivedInput): string {
  return `
    ${bilingualParagraph(
      `We wanted to let you know that we've received a notice from <strong>${esc(input.agency)}</strong>.`,
      `نود إعلامكم بأننا استلمنا إشعاراً من <strong>${esc(input.agency)}</strong>.`
    )}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
           style="background:#f8fafb; border:1px solid #e5e7eb; border-left:3px solid #b45309; border-radius:6px; margin:0 0 18px;">
      <tr><td style="padding:14px 18px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          ${row("Agency", "الجهة", esc(input.agency))}
          ${row("Notice Type", "نوع الإشعار", esc(input.noticeType))}
          ${input.taxPeriod ? row("Period", "الفترة", esc(input.taxPeriod)) : ""}
          ${input.amount !== null ? row("Amount", "المبلغ", money2(input.amount), true) : ""}
          ${input.responseDeadline ? row("Response Deadline", "الموعد النهائي للرد", fmtDate(input.responseDeadline)) : ""}
        </table>
      </td></tr>
    </table>
    ${bilingualParagraph(
      `We're reviewing it now and will reach out if we need anything from you. If you receive any related mail from ${esc(input.agency)}, please forward it to us right away.`,
      `سنقوم بمراجعته وسنتواصل معكم إذا احتجنا إلى أي شيء. إذا استلمتم أي مراسلات متعلقة بهذا من ${esc(input.agency)}، يرجى إرسالها إلينا فوراً.`,
      { color: "#6b7280", marginBottom: 0 }
    )}`;
}

/** Sends the "we received a notice from the agency" heads-up — opt-in per notice (staff checks "Notify Client" when logging it), same as sendFilingConfirmation's "Save and Send". Over every channel the client is opted into. */
export async function sendNoticeReceivedEmail(input: NoticeReceivedInput): Promise<{ sent: boolean }> {
  let emailSent = false;
  if (input.client.emailAllowed && input.client.email) {
    const subject = `We've Received a Notice From ${input.agency} — ${input.noticeType}`;
    const body = noticeReceivedBody(input);
    try {
      const html = await wrapEmailHtml(body, input.req);
      await sendEmail({ to: input.client.email, subject, html });
      await logFilingCommunication("NoticeReceived", input.sourceRecordId, input.client, subject, body, input.client.email, "Sent");
      emailSent = true;
    } catch (err) {
      await recordNotificationFailure(`noticeReceived:${input.sourceRecordId}`, err);
      await logFilingCommunication("NoticeReceived", input.sourceRecordId, input.client, subject, body, input.client.email, "Failed");
    }
  }
  const { sent: smsSent } = await (async () => {
    if (!input.client.smsAllowed || !input.client.phone) return { sent: false };
    const period = input.taxPeriod ? ` (${input.taxPeriod})` : "";
    const body = `AL TAX SERVICE: We received a ${input.noticeType} notice from ${input.agency}${period}. We're reviewing it and will reach out if we need anything from you.`;
    try {
      await sendSms({ to: input.client.phone, body });
      await logFilingCommunication("NoticeReceived", input.sourceRecordId, input.client, `We've Received a Notice From ${input.agency} — ${input.noticeType}`, body, input.client.phone, "Sent", "SMS");
      return { sent: true };
    } catch (err) {
      await recordNotificationFailure(`noticeReceivedSms:${input.sourceRecordId}`, err);
      await logFilingCommunication("NoticeReceived", input.sourceRecordId, input.client, `We've Received a Notice From ${input.agency} — ${input.noticeType}`, body, input.client.phone, "Failed", "SMS");
      return { sent: false };
    }
  })();
  return { sent: emailSent || smsSent };
}
