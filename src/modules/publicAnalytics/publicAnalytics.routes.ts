/**
 * Self-hosted website analytics capture — direct owner request, 2026-08-27,
 * explicitly "the safest way" to see visitor counts and which pages/tools
 * get used most, chosen over Google Analytics or any third-party tracker.
 * No cookies are set anywhere in this file. See sql/113_page_views.sql's
 * top comment for the full privacy design (no raw IP, no raw user-agent,
 * no full referrer URL — all reduced to non-identifying derived values
 * before they ever reach the database).
 *
 * Called once per page load from marketing-site/js/main.js (marketing
 * pages only — never loaded by the authenticated admin/staff/client app),
 * fire-and-forget, skipped entirely when the browser sends Do Not Track.
 */
import crypto from "crypto";
import { Router, Request, Response } from "express";
import { publicToolsQuery } from "../../config/publicToolsDb";
import { asyncHandler } from "../../common/asyncHandler";
import { rateLimit } from "../../common/rateLimit";

export const publicAnalyticsRouter = Router();

// Real browsing can hit several pages a minute (nav clicks, tool pages) —
// generous relative to the contact-form/newsletter limiters, which gate
// far rarer, higher-stakes actions.
const pageviewLimiter = rateLimit({ name: "public-pageview", windowMs: 15 * 60 * 1000, max: 300 });
// Hard Audit finding, 2026-08-27: the per-IP limiter above does nothing
// against a modest botnet or rotating proxy, where every individual
// source stays under 300/15min. This is a hard ceiling on TOTAL volume
// through the route regardless of how many sources it's spread across —
// generous enough that real traffic should never hit it (a small firm's
// marketing site legitimately seeing 6,000 real pageviews in 15 minutes
// would be a very good problem to have), but a real backstop against
// unbounded row growth from a distributed source.
const pageviewGlobalLimiter = rateLimit({ name: "public-pageview-global", windowMs: 15 * 60 * 1000, max: 6000, global: true });

// Fixed, non-secret pepper — not a security boundary (this endpoint has no
// auth to bypass), just makes the hash not a plain, guessable
// sha256(ip+ua+date) that anyone could brute-force-confirm a specific
// IP/UA pair against. Never used to reverse a hash back to an IP; the hash
// is one-way regardless.
const HASH_PEPPER = "altax-nexus-analytics-v1";

function deviceTypeFrom(userAgent: string): string {
  return /Mobi|Android|iPhone|iPad/i.test(userAgent) ? "mobile" : "desktop";
}

function hostFrom(url: string | undefined): string | null {
  if (!url) return null;
  try {
    // Hard Audit finding, 2026-08-27: a hostname that parses fine but is
    // longer than the referrer_host column's VARCHAR(255) reached the
    // INSERT unbounded, tripping an uncaught Postgres "value too long"
    // error (500) on every such request — noisy, wasteful error-path
    // traffic, not a compromise, but easy to trigger by accident or design.
    return new URL(url).hostname.replace(/^www\./, "").slice(0, 255) || null;
  } catch {
    return null;
  }
}

publicAnalyticsRouter.post("/pageview", pageviewLimiter, pageviewGlobalLimiter, asyncHandler(async (req: Request, res: Response) => {
  const path = String(req.body?.path || "").trim().slice(0, 255);
  if (!path || !path.startsWith("/")) return res.status(400).json({ error: "Invalid path." });

  const userAgent = String(req.headers["user-agent"] || "");
  const ip = req.ip || req.socket.remoteAddress || "";
  const today = new Date().toISOString().slice(0, 10);
  const visitorHash = crypto.createHash("sha256").update(`${ip}|${userAgent}|${today}|${HASH_PEPPER}`).digest("hex");

  await publicToolsQuery(
    `INSERT INTO altax_public.v3_page_views (path, referrer_host, device_type, visitor_hash) VALUES ($1, $2, $3, $4)`,
    [path, hostFrom(req.body?.referrer), deviceTypeFrom(userAgent), visitorHash]
  );

  res.status(204).end();
}));
