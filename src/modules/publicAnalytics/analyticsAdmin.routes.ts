/**
 * Staff-facing read side of the self-hosted website analytics captured by
 * publicAnalytics.routes.ts — visitor counts, top pages (which tools/
 * calculators actually get used), device split, top referrers.
 */
import { Router, Response } from "express";
import { query } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { asyncHandler } from "../../common/asyncHandler";

export const analyticsAdminRouter = Router();

const RANGE_DAYS: Record<string, number> = { "7d": 7, "30d": 30, "90d": 90 };

analyticsAdminRouter.get("/summary", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const range = String(req.query.range || "30d");
  const days = RANGE_DAYS[range] ?? 30;

  const [totals, topPages, devices, referrers, daily] = await Promise.all([
    query<any>(
      `SELECT COUNT(*)::int AS views, COUNT(DISTINCT visitor_hash)::int AS unique_visitors
         FROM altax.v3_page_views WHERE viewed_at >= now() - ($1 || ' days')::interval`,
      [days]
    ),
    query<any>(
      `SELECT path, COUNT(*)::int AS views, COUNT(DISTINCT visitor_hash)::int AS unique_visitors
         FROM altax.v3_page_views WHERE viewed_at >= now() - ($1 || ' days')::interval
        GROUP BY path ORDER BY views DESC LIMIT 25`,
      [days]
    ),
    query<any>(
      `SELECT device_type, COUNT(*)::int AS views
         FROM altax.v3_page_views WHERE viewed_at >= now() - ($1 || ' days')::interval
        GROUP BY device_type ORDER BY views DESC`,
      [days]
    ),
    query<any>(
      `SELECT COALESCE(referrer_host, 'Direct / None') AS referrer_host, COUNT(*)::int AS views
         FROM altax.v3_page_views WHERE viewed_at >= now() - ($1 || ' days')::interval
        GROUP BY referrer_host ORDER BY views DESC LIMIT 15`,
      [days]
    ),
    query<any>(
      `SELECT viewed_at::date AS day, COUNT(*)::int AS views, COUNT(DISTINCT visitor_hash)::int AS unique_visitors
         FROM altax.v3_page_views WHERE viewed_at >= now() - ($1 || ' days')::interval
        GROUP BY viewed_at::date ORDER BY day ASC`,
      [days]
    ),
  ]);

  res.json({
    range,
    totalViews: totals[0]?.views || 0,
    uniqueVisitors: totals[0]?.unique_visitors || 0,
    topPages,
    devices,
    referrers,
    daily,
  });
}));
