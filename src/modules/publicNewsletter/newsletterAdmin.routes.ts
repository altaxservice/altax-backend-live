/**
 * Staff-facing read access to the newsletter subscriber list captured by
 * publicNewsletter.routes.ts — otherwise the list would be write-only,
 * visible to nobody but a direct database query. No send action lives here
 * on purpose; see publicNewsletter.routes.ts's top comment for why sending
 * stays a manual, human-reviewed step.
 */
import { Router, Response } from "express";
import { query } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { asyncHandler } from "../../common/asyncHandler";

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
