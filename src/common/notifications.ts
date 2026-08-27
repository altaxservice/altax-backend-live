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
import { publicBaseUrl } from "./publicUrl";

// Unlike the database (see config/db.ts's DATABASE_URL_DEV split), there's no
// separate dev/prod credential for Resend/Twilio — whatever's in .env is live.
// A local `npm run dev` with real keys copied in will actually email/text real
// clients. This can't be split the same way (Resend/Twilio don't offer a free
// sandbox account per environment), so it's a warning, not a hard block — but
// at least it's not a silent trap the way the DB one used to be.
const isProdRuntime = Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_STATIC_URL);
if (!isProdRuntime) {
  if (process.env.RESEND_API_KEY) {
    // eslint-disable-next-line no-console
    console.warn("\n[notifications] WARNING: RESEND_API_KEY is set in this non-production process — sendEmail() here will send REAL email to real recipients.\n");
  }
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    // eslint-disable-next-line no-console
    console.warn("\n[notifications] WARNING: Twilio credentials are set in this non-production process — sendSms()/sendWhatsApp() here will send REAL SMS/WhatsApp to real recipients.\n");
  }
}

export class NotConfiguredError extends Error {}

// The frontend used to have no way to know these weren't connected — reminder
// settings and channel pickers offered "SMS"/"WhatsApp" as if they worked,
// while every actual send silently failed and was swallowed by a "best-effort"
// try/catch. Exported so any picker/toggle can grey out or label the option
// instead of implying it does something it can't.
export function isEmailConfigured(): boolean { return Boolean(process.env.RESEND_API_KEY); }
export function isSmsConfigured(): boolean { return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER); }
export function isWhatsAppConfigured(): boolean { return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_WHATSAPP_FROM); }

/**
 * The communications audit (2026-08-19) found that best-effort notification
 * catch blocks across the app were inconsistent — some console.error'd,
 * some wrote their own one-off logAudit entry, several (notifyStaffOfAppointmentChange's
 * SMS/email catches) logged nothing at all. A genuine failure in any of these was
 * invisible unless someone happened to be tailing server logs. This is the single
 * place every one of those catch blocks should call instead: it always logs to the
 * server console, and — unless the failure is just an unconfigured provider (expected
 * state, already surfaced separately via isEmailConfigured()/isSmsConfigured()) — it
 * also writes one queryable "module: Notifications, action: SEND_FAILED" audit row so
 * Fix Center's "Recent notification failures" check (system.routes.ts) can find it.
 * Never throws: a failure recording a failure must not cascade into a bigger one.
 */
export async function recordNotificationFailure(source: string, err: unknown): Promise<void> {
  if (err instanceof NotConfiguredError) return;
  const message = err instanceof Error ? err.message : String(err);
  // eslint-disable-next-line no-console
  console.error(`[notification] ${source} failed:`, err);
  try {
    // Hard Audit finding, 2026-08-27: a static top-level `import { logAudit }
    // from "./audit"` here meant simply importing sendEmail/sendSms (e.g.
    // publicNewsletter.routes.ts, publicTools.routes.ts) transitively
    // instantiated the main DB pool (config/db.ts's `pool`) at module load —
    // silently pulling every sandboxed public/unauthenticated route's
    // dependency graph back into the main database's connection, even though
    // nothing in those routes ever calls this function today. Deferred to a
    // dynamic import so that link only forms at the moment this function is
    // actually invoked (an authenticated caller wanting failure tracking),
    // not merely by importing this file.
    const { logAudit } = await import("./audit");
    await logAudit("Notifications", "SEND_FAILED", source, "", "", message, `${source} failed: ${message}`, "System");
  } catch (logErr) {
    // eslint-disable-next-line no-console
    console.error(`[notification] recordNotificationFailure could not write audit log for ${source}:`, logErr);
  }
}

export interface EmailAttachment { filename: string; content: Buffer; contentType?: string }

/**
 * Returns Resend's own id for the sent email (result.data.id) — the join key
 * the delivery-status webhook (src/modules/webhooks/webhooks.routes.ts) later
 * uses to find and update the right v3_communications row. null on any legacy
 * caller path that doesn't have a matching Resend response shape (shouldn't
 * happen in practice; typed permissively since Resend's SDK types allow it).
 */
export async function sendEmail(opts: { to: string; cc?: string[]; bcc?: string[]; subject: string; html: string; attachments?: EmailAttachment[] }): Promise<{ providerMessageId: string | null }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new NotConfiguredError("Email is not connected yet — add RESEND_API_KEY to the backend .env to enable sending.");
  const from = process.env.RESEND_FROM_EMAIL || "AL Tax Service <onboarding@resend.dev>";
  const resend = new Resend(apiKey);
  const result = await resend.emails.send({
    from, to: [opts.to], subject: opts.subject, html: opts.html,
    cc: opts.cc?.length ? opts.cc : undefined,
    bcc: opts.bcc?.length ? opts.bcc : undefined,
    attachments: opts.attachments?.map((a) => ({ filename: a.filename, content: a.content, contentType: a.contentType })),
  });
  if (result.error) throw new Error(result.error.message || "Resend rejected this email.");
  return { providerMessageId: result.data?.id || null };
}

/**
 * Turns whatever a "CC"/"BCC" input sent us — a comma/semicolon-separated
 * string from a plain text field, an array, or nothing — into a clean list
 * of email addresses. Loose validation (must contain "@") is enough here:
 * Resend itself will reject anything malformed, and this is staff typing
 * their own colleagues' addresses, not untrusted public input.
 */
export function parseEmailList(value: unknown): string[] | undefined {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[,;]/) : [];
  const cleaned = raw.map((v) => String(v).trim()).filter((v) => v.includes("@"));
  return cleaned.length ? cleaned : undefined;
}

function twilioClient(): ReturnType<typeof twilio> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) throw new NotConfiguredError("SMS/WhatsApp is not connected yet — add TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN to the backend .env to enable sending.");
  return twilio(sid, token);
}

/** Returns Twilio's own message SID — the join key the delivery-status webhook later uses (see sendEmail's comment above for the same pattern). */
export async function sendSms(opts: { to: string; body: string }): Promise<{ providerMessageId: string | null }> {
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!from) throw new NotConfiguredError("SMS is not connected yet — add TWILIO_FROM_NUMBER to the backend .env to enable sending.");
  const client = twilioClient();
  const message = await client.messages.create({ from, to: opts.to, body: opts.body, statusCallback: twilioStatusCallbackUrl() });
  return { providerMessageId: message.sid || null };
}

export async function sendWhatsApp(opts: { to: string; body: string }): Promise<{ providerMessageId: string | null }> {
  const from = process.env.TWILIO_WHATSAPP_FROM;
  if (!from) throw new NotConfiguredError("WhatsApp is not connected yet — add TWILIO_WHATSAPP_FROM to the backend .env (requires Twilio's WhatsApp Business API + Meta verification) to enable sending.");
  const client = twilioClient();
  const message = await client.messages.create({ from: `whatsapp:${from}`, to: `whatsapp:${opts.to}`, body: opts.body, statusCallback: twilioStatusCallbackUrl() });
  return { providerMessageId: message.sid || null };
}

/**
 * Twilio only calls a status-callback URL if the message itself set one (or
 * the phone number's default webhook is configured in the Twilio console,
 * which this app doesn't rely on) — passed explicitly here so delivery status
 * works the moment Twilio credentials are set, with no separate Twilio-
 * console configuration step. publicBaseUrl() with no req falls back to
 * Railway's auto-injected RAILWAY_PUBLIC_DOMAIN (see publicUrl.ts) — this
 * function is called from cron jobs with no request context, same situation
 * that helper was already built for. Returns undefined (Twilio SDK then just
 * doesn't request a callback) when neither is available — SMS/WhatsApp still
 * sends, it just won't get delivery-status updates.
 */
function twilioStatusCallbackUrl(): string | undefined {
  const base = publicBaseUrl();
  return base ? `${base}/webhooks/twilio` : undefined;
}
