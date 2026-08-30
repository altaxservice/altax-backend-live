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
import { sendEmail, recordNotificationFailure } from "./notifications";
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
  return Number.isNaN(d.getTime()) ? "—" : `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`;
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

export interface FilingClientInfo {
  clientId: string;
  clientName: string;
  email: string | null;
  emailAllowed: boolean;
}

async function logFilingCommunication(
  sourceSystem: string, sourceRecordId: string, client: FilingClientInfo, subject: string, bodyText: string, sentTo: string, status: "Sent" | "Failed"
): Promise<void> {
  await query(
    `INSERT INTO altax.v3_communications
       (communication_id, client_id, client_name, related_task_id, subject, message_english, message_arabic,
        sent_to, sent_by, direction, channel, sent_at, status, source_system, source_record_id, provider_message_id)
     VALUES ($1,$2,$3,NULL,$4,$5,'',$6,$7,'Outbound','Email',now(),$8,$9,$10,NULL)`,
    [`COM-${idSuffix()}`, client.clientId, client.clientName, subject, bodyText, sentTo, "System", status, sourceSystem, sourceRecordId]
  );
}

export interface FilingConfirmationInput {
  client: FilingClientInfo;
  sourceRecordId: string; // same key used for the v3_payment_reminders row this filing schedules, if any
  filingType: string;
  periodLabel: string | null;
  filedDate: string;
  amount: number;
  paymentDueDate: string;
  paidDate: string | null;
  acknowledgeUrl?: string;
  req?: Request;
}

/** Body used both as the email HTML and (plain-text-ish) as the v3_communications log entry. */
function filingConfirmationBody(input: FilingConfirmationInput): string {
  return `
    <p style="margin:0 0 18px;">This is a confirmation that we filed your ${esc(input.filingType)}${input.periodLabel ? ` for the period ${esc(input.periodLabel)}` : ""}. <bdi dir="rtl" style="color:#9ca3af;">/ هذا تأكيد بأننا قدمنا إقرارك${input.periodLabel ? " عن الفترة المذكورة" : ""}.</bdi></p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
           style="background:#f8fafb; border:1px solid #e5e7eb; border-left:3px solid #0f766e; border-radius:6px; margin:0 0 18px;">
      <tr><td style="padding:14px 18px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          ${row("Filing Type", "نوع الإقرار", esc(input.filingType))}
          ${input.periodLabel ? row("Period", "الفترة", esc(input.periodLabel)) : ""}
          ${row("Filed Date", "تاريخ التقديم", fmtDate(input.filedDate))}
          ${row("Amount", "المبلغ", money2(input.amount), true)}
          ${input.paidDate ? row("Payment Date", "تاريخ الدفع", fmtDate(input.paidDate)) : row("Payment Due Date", "تاريخ استحقاق الدفع", fmtDate(input.paymentDueDate))}
        </table>
      </td></tr>
    </table>
    ${input.acknowledgeUrl ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 18px;">
      <tr><td style="border-radius:6px; background:#0f766e;"><a href="${esc(input.acknowledgeUrl)}" style="display:inline-block; padding:11px 22px; color:#fff; font-size:13.5px; font-weight:600; text-decoration:none;">View & Acknowledge Report</a></td></tr>
    </table>` : ""}
    <p style="margin:0; color:#6b7280; font-size:12.5px;">${input.paidDate ? "This filing is paid in full." : "We'll send a reminder before the payment due date above. If you have any questions, just reply to this email."} <bdi dir="rtl">${input.paidDate ? "تم دفع هذا الإقرار بالكامل." : "سنرسل تذكيراً قبل تاريخ استحقاق الدفع أعلاه. إذا كانت لديك أي أسئلة، فقط قم بالرد على هذا البريد الإلكتروني."}</bdi></p>`;
}

/** Sends the immediate "we filed this" confirmation. Silent no-op (not a failure) when the client has no email consent on file, matching runClientMdSalesTaxDeadlineNotifications's convention. */
export async function sendFilingConfirmation(input: FilingConfirmationInput): Promise<{ sent: boolean }> {
  if (!input.client.emailAllowed || !input.client.email) return { sent: false };
  const subject = `Filing Confirmation — ${input.filingType}${input.periodLabel ? ` (${input.periodLabel})` : ""}`;
  const body = filingConfirmationBody(input);
  try {
    const html = await wrapEmailHtml(body, input.req);
    await sendEmail({ to: input.client.email, subject, html });
    await logFilingCommunication("FilingConfirmation", input.sourceRecordId, input.client, subject, body, input.client.email, "Sent");
    return { sent: true };
  } catch (err) {
    await recordNotificationFailure(`filingConfirmation:${input.sourceRecordId}`, err);
    await logFilingCommunication("FilingConfirmation", input.sourceRecordId, input.client, subject, body, input.client.email, "Failed");
    return { sent: false };
  }
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
    <p style="margin:0 0 18px;">Reminder — your payment for ${esc(input.filingType)}${input.periodLabel ? ` (${esc(input.periodLabel)})` : ""} is coming up. <bdi dir="rtl" style="color:#9ca3af;">/ تذكير — موعد دفعتك يقترب.</bdi></p>
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
    <p style="margin:0; color:#6b7280; font-size:12.5px;">If this has already been paid, please disregard this message. <bdi dir="rtl">إذا كان قد تم دفع هذا المبلغ بالفعل، يرجى تجاهل هذه الرسالة.</bdi></p>`;
}

/** Sends the 9AM-ET-day-before payment-due reminder. Same consent gating and logging convention as sendFilingConfirmation. */
export async function sendPaymentDueReminder(input: PaymentDueReminderInput): Promise<{ sent: boolean }> {
  if (!input.client.emailAllowed || !input.client.email) return { sent: false };
  const subject = `Reminder: Payment Due Soon — ${input.filingType}${input.periodLabel ? ` (${input.periodLabel})` : ""}`;
  const body = paymentDueReminderBody(input);
  try {
    const html = await wrapEmailHtml(body, input.req);
    await sendEmail({ to: input.client.email, subject, html });
    await logFilingCommunication("PaymentDueReminder", input.sourceRecordId, input.client, subject, body, input.client.email, "Sent");
    return { sent: true };
  } catch (err) {
    await recordNotificationFailure(`paymentDueReminder:${input.sourceRecordId}`, err);
    await logFilingCommunication("PaymentDueReminder", input.sourceRecordId, input.client, subject, body, input.client.email, "Failed");
    return { sent: false };
  }
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

  return `
    <p style="margin:0 0 18px;">This is a confirmation of your federal payroll tax deposit (EFTPS) for ${esc(input.periodLabel)}. <bdi dir="rtl" style="color:#9ca3af;">/ هذا تأكيد لإيداع ضريبة الرواتب الفيدرالية الخاصة بكم عن الفترة المذكورة.</bdi></p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
           style="background:#f8fafb; border:1px solid #e5e7eb; border-left:3px solid #0f766e; border-radius:6px; margin:0 0 18px;">
      <tr><td style="padding:14px 18px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          ${row("Period", "الفترة", esc(input.periodLabel))}
          ${row("Filed Date", "تاريخ التقديم", fmtDate(input.filingDate))}
          ${row("Due Date", "تاريخ الاستحقاق", fmtDate(input.dueDate))}
          ${row("Payment Date", "تاريخ الدفع", fmtDate(input.paymentDate))}
          ${row("Federal Income Tax", "ضريبة الدخل الفيدرالية", money2(input.federalIncomeTaxTotal))}
          ${row("Social Security", "الضمان الاجتماعي", money2(input.socialSecurityTotal))}
          ${row("Medicare", "الرعاية الطبية", money2(input.medicareTotal))}
          ${row("Total Federal Deposit", "إجمالي الإيداع الفيدرالي", money2(input.totalAmount), true)}
        </table>
      </td></tr>
    </table>
    <p style="margin:0 0 8px; font-size:13px; font-weight:600; color:#374151;">By Employee <bdi dir="rtl" style="color:#9ca3af; font-weight:400;">/ حسب الموظف</bdi></p>
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
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 4px;">
      <tr><td style="border-radius:6px; background:#0f766e;"><a href="${esc(input.acknowledgeUrl)}" style="display:inline-block; padding:11px 22px; color:#fff; font-size:13.5px; font-weight:600; text-decoration:none;">View & Acknowledge Report</a></td></tr>
    </table>
    ${googleCalendarUrl ? buildAddToCalendarButtonHtml(googleCalendarUrl, { theme: "green" }).replace('margin-top:10px', 'margin:4px 0 18px; text-align:left') : ""}
    <p style="margin:0; color:#6b7280; font-size:12.5px;">This report covers federal deposit amounts only — state withholding and unemployment insurance are covered separately in your quarterly payroll report. <bdi dir="rtl">يغطي هذا التقرير مبالغ الإيداع الفيدرالي فقط.</bdi></p>`;
}

/** Save & Send for the EFTPS deposit workflow — a real per-employee federal breakdown, not the single-amount shape sendFilingConfirmation uses elsewhere. Same consent gating and logging convention as the rest of this file. */
export async function sendEftpsDepositReport(input: EftpsDepositReportInput): Promise<{ sent: boolean }> {
  if (!input.client.emailAllowed || !input.client.email) return { sent: false };
  const subject = `Federal Tax Deposit Report — ${input.periodLabel}`;
  const body = eftpsDepositReportBody(input);
  try {
    const html = await wrapEmailHtml(body, input.req);
    await sendEmail({ to: input.client.email, subject, html });
    await logFilingCommunication("EftpsDepositReport", input.sourceRecordId, input.client, subject, body, input.client.email, "Sent");
    return { sent: true };
  } catch (err) {
    await recordNotificationFailure(`eftpsDepositReport:${input.sourceRecordId}`, err);
    await logFilingCommunication("EftpsDepositReport", input.sourceRecordId, input.client, subject, body, input.client.email, "Failed");
    return { sent: false };
  }
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
    <p style="margin:0 0 18px;">We wanted to let you know that we've received a notice from ${esc(input.agency)}. <bdi dir="rtl" style="color:#9ca3af;">/ نود إعلامكم بأننا استلمنا إشعاراً من ${esc(input.agency)}.</bdi></p>
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
    <p style="margin:0; color:#6b7280; font-size:12.5px;">We're reviewing it now and will reach out if we need anything from you. If you receive any related mail from ${esc(input.agency)}, please forward it to us right away. <bdi dir="rtl">سنقوم بمراجعته وسنتواصل معكم إذا احتجنا إلى أي شيء. إذا استلمتم أي مراسلات متعلقة بهذا من ${esc(input.agency)}، يرجى إرسالها إلينا فوراً.</bdi></p>`;
}

/** Sends the "we received a notice from the agency" heads-up — opt-in per notice (staff checks "Notify Client" when logging it), same as sendFilingConfirmation's "Save and Send". Silent no-op without email consent. */
export async function sendNoticeReceivedEmail(input: NoticeReceivedInput): Promise<{ sent: boolean }> {
  if (!input.client.emailAllowed || !input.client.email) return { sent: false };
  const subject = `We've Received a Notice From ${input.agency} — ${input.noticeType}`;
  const body = noticeReceivedBody(input);
  try {
    const html = await wrapEmailHtml(body, input.req);
    await sendEmail({ to: input.client.email, subject, html });
    await logFilingCommunication("NoticeReceived", input.sourceRecordId, input.client, subject, body, input.client.email, "Sent");
    return { sent: true };
  } catch (err) {
    await recordNotificationFailure(`noticeReceived:${input.sourceRecordId}`, err);
    await logFilingCommunication("NoticeReceived", input.sourceRecordId, input.client, subject, body, input.client.email, "Failed");
    return { sent: false };
  }
}
