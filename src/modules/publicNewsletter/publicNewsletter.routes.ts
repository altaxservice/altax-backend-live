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
 *
 * Hard Audit fixes, 2026-08-27:
 *   - Uses publicToolsQuery/publicToolsQueryOne (the sandboxed altax_public
 *     role, zero grants on the altax schema) instead of the main DB pool —
 *     matching every other public/unauthenticated write path in this app.
 *     The table itself moved to the altax_public schema for the same
 *     reason (sql/115_newsletter_sandboxed_double_optin.sql).
 *   - publicBaseUrl() is called with NO req here. req.get("host") reflects
 *     whatever Host header the caller sends — for an authenticated staff
 *     route that's harmless (only the caller's own session is affected),
 *     but this route is unauthenticated and the resulting link gets EMAILED
 *     TO A THIRD PARTY (the address the caller puts in the request body,
 *     not the caller themselves). Passing req here let anyone send a real
 *     "click here" email to any victim address with a link pointing
 *     anywhere they chose. publicBaseUrl() with no req falls back only to
 *     RAILWAY_PUBLIC_DOMAIN, a platform-injected env var no caller can
 *     influence.
 *   - Double opt-in: /subscribe no longer marks anyone 'subscribed' or logs
 *     them as a real recipient — it emails a generic "confirm or ignore"
 *     link, and only /confirm (requires the token from that email) flips
 *     status to 'subscribed'. This is what actually stops the endpoint from
 *     being usable to mail-bomb an arbitrary victim with genuine-looking
 *     "you're subscribed" emails: the confirm email is generic/harmless
 *     regardless of who requests it, and nothing lands on the real send
 *     list without the recipient's own click.
 */
import crypto from "crypto";
import { Router, Request, Response } from "express";
import { publicToolsQuery, publicToolsQueryOne } from "../../config/publicToolsDb";
import { asyncHandler } from "../../common/asyncHandler";
import { sendEmail, NotConfiguredError } from "../../common/notifications";
import { rateLimit } from "../../common/rateLimit";
import { publicBaseUrl } from "../../common/publicUrl";

export const publicNewsletterRouter = Router();

const subscribeLimiter = rateLimit({ name: "public-newsletter-subscribe", windowMs: 15 * 60 * 1000, max: 10 });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function newToken(): string {
  return crypto.randomBytes(24).toString("hex");
}

publicNewsletterRouter.post("/subscribe", subscribeLimiter, asyncHandler(async (req: Request, res: Response) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!email || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: "A valid email address is required." });
  }

  const existing = await publicToolsQueryOne<any>(
    `SELECT subscriber_id, status FROM altax_public.v3_newsletter_subscribers WHERE email = $1`,
    [email]
  );
  // Already confirmed — nothing to do (and no reason to re-send a
  // confirm email to someone already on the list).
  if (existing?.status === "subscribed") {
    return res.json({ ok: true });
  }

  const subscriberId = existing?.subscriber_id || `NL-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
  const confirmToken = newToken();
  const unsubscribeToken = newToken();

  await publicToolsQuery(
    `INSERT INTO altax_public.v3_newsletter_subscribers (subscriber_id, email, status, confirm_token, unsubscribe_token, source, ip_address)
     VALUES ($1, $2, 'pending', $3, $4, $5, $6)
     ON CONFLICT (email) DO UPDATE SET status = 'pending', confirm_token = $3, unsubscribed_at = NULL`,
    [subscriberId, email, confirmToken, unsubscribeToken, "marketing-site-footer", req.ip || null]
  );

  try {
    const base = publicBaseUrl();
    const confirmUrl = base ? `${base}/public/newsletter/confirm?token=${confirmToken}` : null;
    await sendEmail({
      to: email,
      subject: "Confirm your subscription — AL TAX Nexus",
      html: `
        <p>Please confirm you'd like to receive tax deadlines and small-business tips from AL TAX Nexus.</p>
        ${confirmUrl ? `<p><a href="${confirmUrl}">Confirm my subscription</a></p>` : "<p>Please visit our website to confirm your subscription.</p>"}
        <p style="color:#777;font-size:12px;margin-top:24px;">
          If you didn't request this, you can safely ignore this email — you won't be added to any list unless you click the link above.
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

/** Completes double opt-in — the only path that ever sets status = 'subscribed'. */
publicNewsletterRouter.get("/confirm", asyncHandler(async (req: Request, res: Response) => {
  const token = String(req.query.token || "").trim();
  const row = token
    ? await publicToolsQueryOne<any>(`SELECT subscriber_id, status FROM altax_public.v3_newsletter_subscribers WHERE confirm_token = $1`, [token])
    : null;
  if (row && row.status !== "subscribed") {
    await publicToolsQuery(
      `UPDATE altax_public.v3_newsletter_subscribers SET status = 'subscribed', subscribed_at = now(), confirm_token = NULL WHERE confirm_token = $1`,
      [token]
    );
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!doctype html><html><head><meta charset="utf-8"><title>${row ? "Subscribed" : "Link not recognized"} — AL TAX Nexus</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>body{font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:80px auto;padding:0 20px;text-align:center;color:#1c2b30;}a{color:#0f5132;}</style>
    </head><body>
    <h2>${row ? "You're subscribed" : "Link not recognized"}</h2>
    <p>${row ? "Thanks for confirming — you'll hear from us with tax deadlines and small-business tips." : "This confirmation link isn't valid — it may have already been used, or expired."}</p>
    <p><a href="/">Return to our website</a></p>
    </body></html>`);
}));

/** No-login, one-click unsubscribe — the token is the only credential, matching every other public share-token link in this app (contracts, invoices). */
publicNewsletterRouter.get("/unsubscribe", asyncHandler(async (req: Request, res: Response) => {
  const token = String(req.query.token || "").trim();
  const row = token ? await publicToolsQueryOne<any>(`SELECT email FROM altax_public.v3_newsletter_subscribers WHERE unsubscribe_token = $1`, [token]) : null;
  if (row) {
    await publicToolsQuery(`UPDATE altax_public.v3_newsletter_subscribers SET status = 'unsubscribed', unsubscribed_at = now() WHERE unsubscribe_token = $1`, [token]);
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
