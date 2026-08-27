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
import { query } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { asyncHandler } from "../../common/asyncHandler";
import { sendEmail, NotConfiguredError } from "../../common/notifications";
import { publicBaseUrl } from "../../common/publicUrl";
import { logAudit } from "../../common/audit";

export const newsletterAdminRouter = Router();

newsletterAdminRouter.get("/subscribers", requireAuth, requireRole("admin", "staff"), asyncHandler(async (_req: AuthedRequest, res: Response) => {
  const rows = await query<any>(
    `SELECT subscriber_id, email, status, source, subscribed_at, unsubscribed_at
       FROM altax.v3_newsletter_subscribers
      ORDER BY subscribed_at DESC`
  );
  res.json({ subscribers: rows });
}));

newsletterAdminRouter.get("/subscribers/export.csv", requireAuth, requireRole("admin", "staff"), asyncHandler(async (_req: AuthedRequest, res: Response) => {
  const rows = await query<any>(
    `SELECT email, status, subscribed_at FROM altax.v3_newsletter_subscribers WHERE status = 'subscribed' ORDER BY subscribed_at DESC`
  );
  const escapeCsv = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
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
    `SELECT email, unsubscribe_token FROM altax.v3_newsletter_subscribers WHERE status = 'subscribed'`
  );
  if (subscribers.length === 0) return res.status(400).json({ error: "There are no active subscribers to send to." });

  const base = publicBaseUrl(req);
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

  const sendId = `NLS-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
  await query(
    `INSERT INTO altax.v3_newsletter_sends (send_id, subject, body, recipient_count, failed_count, sent_by)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [sendId, subject, bodyText, subscribers.length, failed, req.user!.email]
  );
  await logAudit("Communications", "NEWSLETTER_SENT", sendId, "", "", subject,
    `Newsletter "${subject}" sent to ${sent} of ${subscribers.length} subscriber(s) by ${req.user!.email}${failed ? ` (${failed} failed)` : ""}.`, req.user!.email);

  res.json({ ok: true, sent, failed, total: subscribers.length });
}));
