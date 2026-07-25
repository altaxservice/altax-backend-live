/**
 * Public, no-login contact form submission — the marketing site's "Send us a message"
 * form. The database row is the durable record (including the SMS/WhatsApp consent
 * checkbox state and a timestamp), which doubles as the opt-in audit trail A2P 10DLC
 * campaign review expects. The admin email is best-effort: caught separately so a
 * missing/misconfigured RESEND_API_KEY never fails the submission itself — the
 * database insert is what actually matters.
 */
import { Router, Request, Response } from "express";
import { query, queryOne } from "../../config/db";
import { asyncHandler } from "../../common/asyncHandler";
import { sendEmail, NotConfiguredError } from "../../common/notifications";

export const publicContactRouter = Router();

publicContactRouter.post("/", asyncHandler(async (req: Request, res: Response) => {
  const { company, firstName, lastName, phone, email, reason, smsConsent, website } = req.body || {};

  // Honeypot: "website" is a hidden field no real visitor can see or fill in — only
  // bots that blindly fill every input do. Pretend success so the bot doesn't notice
  // and adjust; just skip the DB insert and admin email entirely.
  if (website) {
    return res.json({ ok: true });
  }

  if (!firstName || !lastName || !phone || !email || !reason) {
    return res.status(400).json({ error: "First name, last name, phone, email, and a message are required." });
  }

  const row = await queryOne<any>(
    `INSERT INTO altax.v3_contact_submissions
       (company_name, first_name, last_name, phone, email, reason, sms_consent, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, submitted_at`,
    [company || null, firstName, lastName, phone, email, reason, !!smsConsent, req.ip || null]
  );

  try {
    const admins = await query<any>(
      `SELECT email FROM altax.v3_users WHERE active = true AND lower(role) = 'admin' AND email IS NOT NULL AND email <> ''`
    );
    const consentLine = smsConsent
      ? "Yes — opted in to SMS/WhatsApp messages at submission."
      : "No — did not opt in to SMS/WhatsApp messages.";
    const html = `
      <h2>New contact form submission</h2>
      <p><strong>Name:</strong> ${firstName} ${lastName}</p>
      ${company ? `<p><strong>Company:</strong> ${company}</p>` : ""}
      <p><strong>Phone:</strong> ${phone}</p>
      <p><strong>Email:</strong> ${email}</p>
      <p><strong>Message:</strong><br>${String(reason).replace(/\n/g, "<br>")}</p>
      <p><strong>SMS/WhatsApp consent:</strong> ${consentLine}</p>
      <p style="color:#777;font-size:12px;">Submitted ${row.submitted_at} · Record #${row.id}</p>
    `;
    for (const admin of admins) {
      await sendEmail({ to: admin.email, subject: `New contact form message from ${firstName} ${lastName}`, html });
    }
  } catch (err) {
    if (!(err instanceof NotConfiguredError)) {
      // eslint-disable-next-line no-console
      console.error("Contact form admin notification failed:", err);
    }
  }

  res.json({ ok: true });
}));
