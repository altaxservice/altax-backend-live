import { AuthedRequest } from "./requireAuth";
import { sendEmail, sendSms, sendWhatsApp, NotConfiguredError } from "./notifications";
import { wrapEmailHtml } from "./emailTemplate";

/**
 * Extracted from communications.routes.ts (where it originated as a private
 * helper for the manual/template-driven Communications composer) so the
 * Phase 4 dashboard alert sweep can reuse the exact same branded email/SMS/
 * WhatsApp delivery path instead of inventing a second one. Re-exported
 * from communications.routes.ts so nothing there had to change.
 */

export interface SendAttachment { filename: string; contentBase64: string; contentType?: string }

const SMS_INLINE_MAX_CHARS = 400;
const ARABIC_CHARS = /[؀-ۿݐ-ݿ]/;

/**
 * Turns a plain-text body into email HTML with correct per-section text direction —
 * splits on a "---" divider and gives each resulting block its own dir="rtl"/"ltr"
 * based on whether it's actually Arabic text, rather than guessing from which
 * language came first.
 */
export function bodyToDirectionalHtml(body: string): string {
  const blocks = body.split(/\n\n---\n\n/);
  return blocks
    .map((block) => {
      const isArabic = ARABIC_CHARS.test(block);
      const html = block.trim().replace(/\n/g, "<br>");
      return isArabic
        ? `<div dir="rtl" style="direction:rtl; text-align:right; unicode-bidi:embed;">${html}</div>`
        : `<div dir="ltr" style="direction:ltr; text-align:left;">${html}</div>`;
    })
    .join('<hr style="border:none; border-top:1px solid #e5e7eb; margin:14px 0;">');
}

/**
 * Attempts a real send for Email/SMS/WhatsApp channels. Never throws — a missing
 * provider key or a delivery failure is reported back as { sent: false, error }
 * rather than blocking the caller (a communication log write, or a dashboard
 * alert record), exactly like sendInviteEmail() in users.routes.ts.
 *
 * Email goes out through wrapEmailHtml — the same branded header/footer shell
 * every other outbound email in the app already uses — and can carry one real
 * attachment. SMS/WhatsApp have no display-name concept, so the firm's name is
 * prefixed onto the body itself, and long bodies collapse to a pointer URL
 * instead of the full text.
 */
export async function sendChannel(
  channel: string, to: string, subject: string, body: string,
  opts: { req?: AuthedRequest; firmName?: string; attachment?: SendAttachment; viewUrl?: string; documentUrl?: string; portalUrl?: string; cc?: string[]; bcc?: string[] } = {}
): Promise<{ sent: boolean; error?: string }> {
  const normalized = String(channel || "").trim().toLowerCase();
  if (!to || !["email", "sms", "whatsapp"].includes(normalized)) return { sent: false };
  try {
    if (normalized === "email") {
      const html = await wrapEmailHtml(bodyToDirectionalHtml(body), opts.req);
      const attachments = opts.attachment
        ? [{ filename: opts.attachment.filename, content: Buffer.from(opts.attachment.contentBase64, "base64"), contentType: opts.attachment.contentType }]
        : undefined;
      await sendEmail({ to, subject, html, attachments, cc: opts.cc, bcc: opts.bcc });
    } else {
      const firmName = opts.firmName || "AL Tax Service";
      let effectiveBody = body.length > SMS_INLINE_MAX_CHARS && opts.viewUrl
        ? `${subject}. View / اطّلع على الرسالة: ${opts.viewUrl}`
        : body;
      if (opts.documentUrl) {
        effectiveBody += ` Attachment: ${opts.documentUrl}`;
        if (opts.portalUrl) effectiveBody += ` Or view it securely in your client portal: ${opts.portalUrl}`;
      } else if (opts.portalUrl) {
        effectiveBody += ` Your attachment is available securely in your client portal: ${opts.portalUrl}`;
      }
      const prefixed = `${firmName}: ${effectiveBody}`;
      if (normalized === "sms") await sendSms({ to, body: prefixed });
      else await sendWhatsApp({ to, body: prefixed });
    }
    return { sent: true };
  } catch (err: any) {
    return { sent: false, error: err instanceof NotConfiguredError ? err.message : (err?.message || "Send failed.") };
  }
}
