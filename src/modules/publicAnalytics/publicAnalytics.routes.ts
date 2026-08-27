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
import { query } from "../../config/db";
import { asyncHandler } from "../../common/asyncHandler";
import { rateLimit } from "../../common/rateLimit";

export const publicAnalyticsRouter = Router();

// Real browsing can hit several pages a minute (nav clicks, tool pages) —
// generous relative to the contact-form/newsletter limiters, which gate
// far rarer, higher-stakes actions.
const pageviewLimiter = rateLimit({ name: "public-pageview", windowMs: 15 * 60 * 1000, max: 300 });

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
    return new URL(url).hostname.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

publicAnalyticsRouter.post("/pageview", pageviewLimiter, asyncHandler(async (req: Request, res: Response) => {
  const path = String(req.body?.path || "").trim().slice(0, 255);
  if (!path || !path.startsWith("/")) return res.status(400).json({ error: "Invalid path." });

  const userAgent = String(req.headers["user-agent"] || "");
  const ip = req.ip || req.socket.remoteAddress || "";
  const today = new Date().toISOString().slice(0, 10);
  const visitorHash = crypto.createHash("sha256").update(`${ip}|${userAgent}|${today}|${HASH_PEPPER}`).digest("hex");

  await query(
    `INSERT INTO altax.v3_page_views (path, referrer_host, device_type, visitor_hash) VALUES ($1, $2, $3, $4)`,
    [path, hostFrom(req.body?.referrer), deviceTypeFrom(userAgent), visitorHash]
  );

  res.status(204).end();
}));
