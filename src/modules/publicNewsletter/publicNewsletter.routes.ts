/**
 * Public newsletter signup — finishes a form that's existed on the marketing
 * site since it was built, but never actually did anything (main.js just
 * alerted "Thanks for subscribing! (static preview)" and threw the email
 * away). Direct owner request, 2026-08-27, in response to reviewing a
 * competitor brochure's "Automated Email Tax Newsletter" feature: build
 * whatever benefits the firm and its clients "without trouble for either
 * side and free of legal matter."
 *
 * Deliberately split into two halves with very different risk profiles:
 *   - CAPTURE (this file): a real, durable subscriber list with a working,
 *     no-login unsubscribe link — safe, mechanical, and required by law
 *     (CAN-SPAM Act) for any future bulk email sent to this list.
 *   - SENDING actual newsletter content: NOT built here on purpose. An
 *     "automated" newsletter that writes and sends its own tax content
 *     unsupervised is a real legal-exposure risk for a tax firm (inaccurate
 *     or stale guidance going out under the firm's name, with nobody
 *     reviewing it) — that's the opposite of "free of legal matter." A
 *     human should draft/review actual newsletter content and trigger the
 *     send; this list is what that future feature would send to.
 */
import crypto from "crypto";
import { Router, Request, Response } from "express";
import { query, queryOne } from "../../config/db";
import { asyncHandler } from "../../common/asyncHandler";
import { sendEmail, NotConfiguredError } from "../../common/notifications";
import { rateLimit } from "../../common/rateLimit";
import { publicBaseUrl } from "../../common/publicUrl";

export const publicNewsletterRouter = Router();

const subscribeLimiter = rateLimit({ name: "public-newsletter-subscribe", windowMs: 15 * 60 * 1000, max: 10 });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

publicNewsletterRouter.post("/subscribe", subscribeLimiter, asyncHandler(async (req: Request, res: Response) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!email || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: "A valid email address is required." });
  }

  const unsubscribeToken = crypto.randomBytes(24).toString("hex");
  // Re-subscribing after a past unsubscribe should just flip status back —
  // never create a second row for the same address, and never silently
  // reuse someone else's still-valid unsubscribe link.
  const row = await queryOne<any>(
    `INSERT INTO altax.v3_newsletter_subscribers (subscriber_id, email, unsubscribe_token, source, ip_address)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (email) DO UPDATE SET status = 'subscribed', unsubscribed_at = NULL
     RETURNING subscriber_id, unsubscribe_token`,
    [`NL-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`, email, unsubscribeToken, "marketing-site-footer", req.ip || null]
  );

  try {
    const base = publicBaseUrl(req);
    const unsubscribeUrl = base ? `${base}/public/newsletter/unsubscribe?token=${row.unsubscribe_token}` : null;
    await sendEmail({
      to: email,
      subject: "You're subscribed — AL TAX Nexus",
      html: `
        <p>Thanks for subscribing — you'll hear from us with tax deadlines and small-business tips.</p>
        <p style="color:#777;font-size:12px;margin-top:24px;">
          ${unsubscribeUrl ? `Didn't mean to sign up? <a href="${unsubscribeUrl}">Unsubscribe</a>.` : "You can unsubscribe from any future email using the link in it."}
        </p>
      `,
    });
  } catch (err) {
    if (!(err instanceof NotConfiguredError)) {
      // eslint-disable-next-line no-console
      console.error("Newsletter confirmation email failed:", err);
    }
  }

  res.json({ ok: true });
}));

/** No-login, one-click unsubscribe — the token is the only credential, matching every other public share-token link in this app (contracts, invoices). */
publicNewsletterRouter.get("/unsubscribe", asyncHandler(async (req: Request, res: Response) => {
  const token = String(req.query.token || "").trim();
  const row = token ? await queryOne<any>(`SELECT email FROM altax.v3_newsletter_subscribers WHERE unsubscribe_token = $1`, [token]) : null;
  if (row) {
    await query(`UPDATE altax.v3_newsletter_subscribers SET status = 'unsubscribed', unsubscribed_at = now() WHERE unsubscribe_token = $1`, [token]);
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!doctype html><html><head><meta charset="utf-8"><title>Unsubscribed — AL TAX Nexus</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>body{font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:80px auto;padding:0 20px;text-align:center;color:#1c2b30;}a{color:#0f5132;}</style>
    </head><body>
    <h2>${row ? "You've been unsubscribed" : "Link not recognized"}</h2>
    <p>${row ? "You won't receive any more emails from this list. If that was a mistake, you can re-subscribe any time from our website." : "This unsubscribe link isn't valid — it may have already been used, or your address may not be on our list."}</p>
    <p><a href="/">Return to our website</a></p>
    </body></html>`);
}));
