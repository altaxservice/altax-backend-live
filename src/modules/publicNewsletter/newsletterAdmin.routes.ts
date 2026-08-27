/**
 * Staff-facing access to the newsletter subscriber list captured by
 * publicNewsletter.routes.ts, plus the one deliberately manual, human-
 * reviewed send action — direct owner request, 2026-08-27, as the
 * follow-through on "subscribe" actually meaning something. Staff type the
 * subject/body themselves (or paste in AI-drafted content they've reviewed)
 * and click Send; nothing here ever generates or sends content on its own.
 * Send is admin-only (not staff) since it's an irreversible bulk external
 * broadcast, same restriction level as other firm-wide external-facing
 * actions in this app (e.g. compliance reminder settings).
 */
import { Router, Response } from "express";
import { query, withTransaction } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { asyncHandler } from "../../common/asyncHandler";
import { sendEmail, NotConfiguredError } from "../../common/notifications";
import { publicBaseUrl } from "../../common/publicUrl";
import { logAudit } from "../../common/audit";

export const newsletterAdminRouter = Router();

newsletterAdminRouter.get("/subscribers", requireAuth, requireRole("admin", "staff"), asyncHandler(async (_req: AuthedRequest, res: Response) => {
  const rows = await query<any>(
    `SELECT subscriber_id, email, status, source, subscribed_at, unsubscribed_at
       FROM altax_public.v3_newsletter_subscribers
      ORDER BY subscribed_at DESC NULLS LAST`
  );
  res.json({ subscribers: rows });
}));

/**
 * Hard Audit finding, 2026-08-27: `escapeCsv` only escaped embedded quotes,
 * not a leading =/+/-/@ — Excel treats a cell starting with one of those as
 * a formula, so a subscriber address like `=HYPERLINK("http://evil","x")@x.com`
 * (which passes the subscribe route's own email regex) could execute when a
 * staff member opens this export. Prefixing a leading tab neutralizes the
 * formula interpretation while leaving the visible cell content unchanged.
 */
function escapeCsv(v: unknown): string {
  let text = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(text)) text = `\t${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

newsletterAdminRouter.get("/subscribers/export.csv", requireAuth, requireRole("admin", "staff"), asyncHandler(async (_req: AuthedRequest, res: Response) => {
  const rows = await query<any>(
    `SELECT email, status, subscribed_at FROM altax_public.v3_newsletter_subscribers WHERE status = 'subscribed' ORDER BY subscribed_at DESC`
  );
  const lines = ["Email,Status,Subscribed At", ...rows.map((r) => [r.email, r.status, r.subscribed_at].map(escapeCsv).join(","))];
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="newsletter-subscribers.csv"`);
  res.send(lines.join("\n"));
}));

newsletterAdminRouter.get("/sends", requireAuth, requireRole("admin", "staff"), asyncHandler(async (_req: AuthedRequest, res: Response) => {
  const rows = await query<any>(
    `SELECT send_id, subject, recipient_count, failed_count, sent_by, sent_at
       FROM altax.v3_newsletter_sends ORDER BY sent_at DESC`
  );
  res.json({ sends: rows });
}));

/**
 * Sends a staff-composed message to every currently-subscribed address.
 * Each email gets its OWN unsubscribe link (that subscriber's real token) —
 * a shared/generic link would let anyone unsubscribe anyone else. Sent
 * one at a time so a single bad address (typo, bounced domain) can't take
 * the whole broadcast down with it; failures are counted, not fatal.
 */
newsletterAdminRouter.post("/send", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const subject = String(req.body?.subject || "").trim();
  const bodyText = String(req.body?.body || "").trim();
  if (!subject || !bodyText) return res.status(400).json({ error: "Subject and body are required." });

  const subscribers = await query<any>(
    `SELECT email, unsubscribe_token FROM altax_public.v3_newsletter_subscribers WHERE status = 'subscribed'`
  );
  if (subscribers.length === 0) return res.status(400).json({ error: "There are no active subscribers to send to." });

  // Hard Audit finding, 2026-08-27: no guard against a double-click or a
  // client-side retry re-sending the identical broadcast to every
  // subscriber a second time. Advisory lock + a short recent-duplicate
  // check, same shape as reminders.routes.ts's sendAndLog and
  // complianceReminders.ts's sweep — keyed on the exact subject+body rather
  // than a client-supplied id, since two DIFFERENT newsletters are always
  // welcome, only an identical accidental repeat within a few minutes isn't.
  const dedupKey = `NEWSLETTER-SEND-${subject}-${bodyText}`;
  const claim = await withTransaction(async (db) => {
    await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [dedupKey]);
    const recent = await db.queryOne<any>(
      `SELECT 1 FROM altax.v3_newsletter_sends WHERE subject = $1 AND body = $2 AND sent_at > now() - interval '5 minutes'`,
      [subject, bodyText]
    );
    if (recent) return { alreadySending: true, sendId: null as string | null };
    // Claim this send immediately (recipient/failed counts updated below,
    // after the actual sending loop, keyed by this same send_id) so a
    // second request arriving mid-send sees this row and backs off instead
    // of racing the same broadcast.
    const sendId = `NLS-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
    await db.query(
      `INSERT INTO altax.v3_newsletter_sends (send_id, subject, body, recipient_count, failed_count, sent_by)
       VALUES ($1, $2, $3, 0, 0, $4)`,
      [sendId, subject, bodyText, req.user!.email]
    );
    return { alreadySending: false, sendId };
  });
  if (claim.alreadySending) {
    return res.status(409).json({ error: "This exact newsletter was already sent in the last few minutes." });
  }
  const sendId = claim.sendId!;

  const base = publicBaseUrl();
  const bodyHtml = bodyText.split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("");

  let sent = 0;
  let failed = 0;
  for (const s of subscribers) {
    const unsubscribeUrl = base ? `${base}/public/newsletter/unsubscribe?token=${s.unsubscribe_token}` : null;
    const html = `${bodyHtml}<p style="color:#777;font-size:12px;margin-top:24px;">${unsubscribeUrl ? `<a href="${unsubscribeUrl}">Unsubscribe</a> from these emails.` : "Reply to unsubscribe from these emails."}</p>`;
    try {
      await sendEmail({ to: s.email, subject, html });
      sent++;
    } catch (err) {
      failed++;
      if (err instanceof NotConfiguredError) break; // email isn't connected at all — retrying per-recipient won't help
      // eslint-disable-next-line no-console
      console.error(`Newsletter send failed for ${s.email}:`, err);
    }
  }

  await query(
    `UPDATE altax.v3_newsletter_sends SET recipient_count = $2, failed_count = $3 WHERE send_id = $1`,
    [sendId, subscribers.length, failed]
  );
  await logAudit("Communications", "NEWSLETTER_SENT", sendId, "", "", subject,
    `Newsletter "${subject}" sent to ${sent} of ${subscribers.length} subscriber(s) by ${req.user!.email}${failed ? ` (${failed} failed)` : ""}.`, req.user!.email);

  res.json({ ok: true, sent, failed, total: subscribers.length });
}));
