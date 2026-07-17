/**
 * Outbound notification providers — email via Resend, SMS/WhatsApp via Twilio. Built at
 * the user's explicit request (previously deferred all session; see the "email/storage
 * deferred" call). Each function is gated on its own env vars and throws a plain,
 * catchable "not configured" error when they're missing — callers (billing.routes.ts)
 * catch per-channel so one missing provider doesn't block the others, and the UI shows
 * exactly which channel failed and why instead of a generic 500.
 */
import { Resend } from "resend";
import twilio from "twilio";

export class NotConfiguredError extends Error {}

export interface EmailAttachment { filename: string; content: Buffer; contentType?: string }

export async function sendEmail(opts: { to: string; subject: string; html: string; attachments?: EmailAttachment[] }): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new NotConfiguredError("Email is not connected yet — add RESEND_API_KEY to the backend .env to enable sending.");
  const from = process.env.RESEND_FROM_EMAIL || "AL Tax Service <onboarding@resend.dev>";
  const resend = new Resend(apiKey);
  const result = await resend.emails.send({
    from, to: [opts.to], subject: opts.subject, html: opts.html,
    attachments: opts.attachments?.map((a) => ({ filename: a.filename, content: a.content })),
  });
  if (result.error) throw new Error(result.error.message || "Resend rejected this email.");
}

function twilioClient(): ReturnType<typeof twilio> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) throw new NotConfiguredError("SMS/WhatsApp is not connected yet — add TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN to the backend .env to enable sending.");
  return twilio(sid, token);
}

export async function sendSms(opts: { to: string; body: string }): Promise<void> {
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!from) throw new NotConfiguredError("SMS is not connected yet — add TWILIO_FROM_NUMBER to the backend .env to enable sending.");
  const client = twilioClient();
  await client.messages.create({ from, to: opts.to, body: opts.body });
}

export async function sendWhatsApp(opts: { to: string; body: string }): Promise<void> {
  const from = process.env.TWILIO_WHATSAPP_FROM;
  if (!from) throw new NotConfiguredError("WhatsApp is not connected yet — add TWILIO_WHATSAPP_FROM to the backend .env (requires Twilio's WhatsApp Business API + Meta verification) to enable sending.");
  const client = twilioClient();
  await client.messages.create({ from: `whatsapp:${from}`, to: `whatsapp:${opts.to}`, body: opts.body });
}
