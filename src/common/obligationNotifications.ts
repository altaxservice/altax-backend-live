/**
 * Shared "the firm has been told a client confirmed a filing/deposit" notice —
 * an internal-only staff heads-up, not a client-facing template. Modeled
 * directly on notifyStaffOfAppointmentChange/resolveStaffRecipients/
 * buildStaffApptNoticeHtml (appointments.routes.ts), the app's existing,
 * working "client confirmed → tell staff" pattern, so obligation modules
 * (EFTPS, MD Sales Tax, and future ones) share one implementation instead of
 * each rebuilding recipient resolution and layout from scratch.
 *
 * Recipients are the client's assigned staff member (v3_clients.assigned_to,
 * falling back to "AL" — the same fallback used for task assignment at
 * rules.routes.ts) plus every active admin. Not logged to v3_communications —
 * matches the appointments precedent, since this is an internal notice, not a
 * client communication.
 */
import { Request } from "express";
import { query, queryOne } from "../config/db";
import { sendEmail, recordNotificationFailure } from "./notifications";
import { wrapEmailHtml } from "./emailTemplate";
import { escapeHtml } from "./html";

function money2(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", { timeZone: "America/New_York", month: "numeric", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export interface ObligationConfirmedInput {
  clientId: string;
  clientName: string;
  filingType: string;
  periodLabel: string | null;
  amount: number;
  acknowledgedAt: string; // ISO
  acknowledgedIp: string | null;
  detailUrl?: string;
  req?: Request;
}

async function resolveClientStaffRecipients(clientId: string): Promise<string[]> {
  const client = await queryOne<any>(`SELECT assigned_to FROM altax.v3_clients WHERE client_id = $1`, [clientId]);
  const assignedTo = String(client?.assigned_to || "AL").trim();
  const rows = await query<any>(
    `SELECT email FROM altax.v3_users
      WHERE coalesce(active, true)
        AND (lower(role) = 'admin' OR lower(email) = lower($1) OR lower(name) = lower($1) OR lower(user_id) = lower($1))`,
    [assignedTo]
  );
  const emails = new Set<string>();
  for (const r of rows) {
    if (r.email) emails.add(String(r.email).toLowerCase());
  }
  return Array.from(emails);
}

function buildObligationConfirmedHtml(input: ObligationConfirmedInput): string {
  const rows = [
    { label: "Client", value: escapeHtml(input.clientName) },
    ...(input.periodLabel ? [{ label: "Period", value: escapeHtml(input.periodLabel) }] : []),
    { label: "Amount", value: money2(input.amount) },
    { label: "Confirmed", value: `${escapeHtml(fmtDateTime(input.acknowledgedAt))} ET` },
  ];
  return `
    <div style="max-width:480px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
      <div style="background:#0f5132;color:#ffffff;padding:16px 20px;border-radius:10px 10px 0 0;">
        <div style="font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;opacity:0.85;">Client Confirmed</div>
        <div style="font-size:19px;font-weight:800;margin-top:4px;">${escapeHtml(input.filingType)}</div>
      </div>
      <div style="border:1px solid #e0e0e0;border-top:none;border-radius:0 0 10px 10px;padding:18px 20px;font-size:14px;">
        <table style="width:100%;border-collapse:collapse;font-size:14px;">
          ${rows.map((r) => `<tr><td style="padding:5px 0;color:#666;width:90px;">${escapeHtml(r.label)}</td><td style="padding:5px 0;font-weight:700;">${r.value}</td></tr>`).join("")}
        </table>
        ${input.detailUrl ? `<div style="margin-top:14px;"><a href="${escapeHtml(input.detailUrl)}" style="color:#0f766e;font-weight:600;text-decoration:none;font-size:13px;">Open in AL TAX Nexus →</a></div>` : ""}
      </div>
    </div>`;
}

/** Fires once, right when a client acknowledges a filing/deposit via its public link. Caller is responsible for its own idempotency (an atomic claim on the acknowledge row) — this function does not re-check. */
export async function notifyStaffOfObligationConfirmed(input: ObligationConfirmedInput): Promise<void> {
  const recipients = await resolveClientStaffRecipients(input.clientId);
  if (recipients.length === 0) return;
  const subject = `Client confirmed: ${input.filingType}${input.periodLabel ? ` (${input.periodLabel})` : ""} — ${input.clientName}`;
  const html = await wrapEmailHtml(buildObligationConfirmedHtml(input), input.req);
  for (const email of recipients) {
    try {
      await sendEmail({ to: email, subject, html });
    } catch (err) {
      await recordNotificationFailure(`obligationConfirmed:${input.clientId}:${email}`, err);
    }
  }
}
