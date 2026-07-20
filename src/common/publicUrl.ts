import type { Request } from "express";

/**
 * Resolves this deployment's own public origin — used only where an absolute
 * URL is needed outside a request/response cycle (e.g. the 6:30AM cron digest,
 * which has no `req` to read protocol/host from). Prefers the incoming
 * request when one is available (always correct, no config needed).
 * RAILWAY_PUBLIC_DOMAIN is injected automatically by Railway for any service
 * with a public domain, so — unlike a hand-set FRONTEND_BASE_URL — it can't
 * drift to a stale/local value. Returns null (never a guess) if neither is
 * available, so callers can simply omit whatever needed the URL.
 */
export function publicBaseUrl(req?: Request): string | null {
  if (req) return `${req.protocol}://${req.get("host")}`.replace(/\/+$/, "");
  if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  return null;
}
