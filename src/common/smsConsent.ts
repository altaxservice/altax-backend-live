import { query } from "../config/db";
import { getFirmProfile, addressLines } from "./firmProfile";

/**
 * Consent gate for texts and marketing-type emails that staff send to a
 * number or address THEY typed (brochure send, estimate send, e-sign links),
 * as opposed to the automatic reminders, which already check
 * v3_clients.sms_allowed themselves.
 *
 * Basis: TCPA, 47 CFR 64.1200(a)(10)-(12) (prior express consent for texts
 * sent with an automatic telephone dialing system / to cell phones) and
 * CAN-SPAM, 15 USC 7704 (sender identification + opt-out in commercial email).
 *
 * Rules:
 *  - The number belongs to a client (by id, or by phone match) -> that client's
 *    sms_allowed MUST be true. Staff cannot override it.
 *  - The number belongs to nobody on file -> staff must confirm the recipient
 *    asked to be texted (a required checkbox, sent as boolean true) and that
 *    confirmation is written to the audit log by the caller.
 */

export const SMS_OPT_OUT_LINE = "Reply STOP to opt out.";
export const EMAIL_OPT_OUT_TEXT = "Reply to this email with STOP and we will not email you again about this.";

export function phoneDigits(raw: string): string {
  const d = String(raw || "").replace(/\D/g, "");
  return d.length > 10 ? d.slice(-10) : d;
}

export interface SmsConsentResult {
  allowed: boolean;
  /** "client" = a client with sms_allowed on; "recipient-confirmed" = non-client, staff confirmed. */
  basis?: "client" | "recipient-confirmed";
  clientId?: string | null;
  error?: string;
}

/**
 * @param phone              the number the text will go to
 * @param clientId           the client the send is tied to, if any
 * @param recipientConfirmed the checkbox value from the UI (must be literally true)
 */
export async function checkSmsConsent(opts: { phone: string; clientId?: string | null; recipientConfirmed?: unknown }): Promise<SmsConsentResult> {
  const digits = phoneDigits(opts.phone);
  if (digits.length < 10) return { allowed: false, error: "That phone number does not look valid." };

  // Candidate client records: the one the send is tied to, plus any client whose stored phone matches the typed number.
  const list = (await query<{ client_id: string; client_name: string; phone: string | null; sms_allowed: boolean | null }>(
    `SELECT client_id, client_name, phone, sms_allowed FROM altax.v3_clients
      WHERE client_id = $1
         OR right(regexp_replace(coalesce(phone, ''), '\\D', '', 'g'), 10) = $2`,
    [opts.clientId || "", digits]
  ));

  const tied = opts.clientId ? list.find((r) => r.client_id === opts.clientId) : null;
  const phoneMatches = list.filter((r) => phoneDigits(r.phone || "") === digits);

  if (tied) {
    // A client the send is tied to: their own consent flag decides, whichever number was typed.
    if (!tied.sms_allowed) {
      return { allowed: false, clientId: tied.client_id, error: `${tied.client_name} has not agreed to text messages. Turn on "SMS allowed" in their profile first (only after they agree), or send by email instead.` };
    }
    // Typed number differs from every stored number: consent was given for the stored number, not this one.
    if (phoneMatches.length === 0 && tied.phone && phoneDigits(tied.phone) !== digits) {
      return { allowed: false, clientId: tied.client_id, error: "That number is not the phone number on this client's profile. Update the profile number (with the client's agreement) or text the number on file." };
    }
    return { allowed: true, basis: "client", clientId: tied.client_id };
  }

  if (phoneMatches.length > 0) {
    // The number belongs to a client on file: all matching clients must have agreed.
    const blocked = phoneMatches.find((r) => !r.sms_allowed);
    if (blocked) {
      return { allowed: false, clientId: blocked.client_id, error: `${blocked.client_name} has not agreed to text messages. Turn on "SMS allowed" in their profile first (only after they agree), or send by email instead.` };
    }
    return { allowed: true, basis: "client", clientId: phoneMatches[0].client_id };
  }

  // Not a client: staff must confirm the recipient asked for texts about this.
  if (opts.recipientConfirmed !== true) {
    return { allowed: false, error: "This number is not a client with text messages turned on. Confirm that the recipient asked us to text them about this, or send by email." };
  }
  return { allowed: true, basis: "recipient-confirmed", clientId: null };
}

/** Appends the opt-out line to a text unless it is already there. */
export function withSmsOptOut(body: string): string {
  const t = body.trim();
  return t.toLowerCase().endsWith(SMS_OPT_OUT_LINE.toLowerCase()) ? t : `${t}\n\n${SMS_OPT_OUT_LINE}`;
}

/** Sender identification + opt-out block for emails sent to people who are not (yet) clients. */
export async function emailOptOutBlockHtml(): Promise<string> {
  const firm = await getFirmProfile();
  const sender = [firm.firmName, ...addressLines(firm)].filter(Boolean).join(", ");
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<p style="color:#6b7280; font-size:12.5px; margin-top:18px;">${esc(sender)}<br>${esc(EMAIL_OPT_OUT_TEXT)}</p>`;
}
