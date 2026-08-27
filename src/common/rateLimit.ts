/**
 * Sliding-window rate limiting for the unauthenticated auth endpoints.
 *
 * The per-account lockout (5 failures, 15 minutes) already existed, but it only
 * ever protects ONE account at a time. It does nothing against the attack these
 * endpoints actually face: password spraying, where one common password is
 * tried against many different accounts. Every attempt hits a different account,
 * so no single counter ever reaches its limit and nothing trips.
 *
 * This limits by source IP as well, which is the dimension the spray shares.
 *
 * Deliberately in-memory rather than a Redis/store dependency: the app runs as a
 * single Railway service, and a restart clearing the counters is acceptable —
 * the real credential boundary is the password and the second factor, this is
 * defence in depth. A distributed store would be required only if this ever
 * scales to multiple instances.
 */
import { Request, Response, NextFunction } from "express";

interface Hit {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Hit>();

// Bounded sweep so a long-running process cannot accumulate keys indefinitely.
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [key, hit] of buckets) {
    if (hit.resetAt <= now) buckets.delete(key);
  }
}, SWEEP_INTERVAL_MS).unref();

/**
 * `trust proxy` is enabled in server.ts, so req.ip is the real client address
 * from X-Forwarded-For rather than Railway's internal proxy.
 */
function clientKey(req: Request): string {
  return req.ip || req.socket.remoteAddress || "unknown";
}

export interface RateLimitOptions {
  /** Window length in milliseconds. */
  windowMs: number;
  /** Maximum requests permitted from one key within the window. */
  max: number;
  /** Distinguishes buckets so separate routes don't share a counter. */
  name: string;
  /**
   * Adds a second dimension to the key — normally the submitted email — so one
   * account cannot be targeted from many IPs either. Errors are swallowed:
   * limiting must never break a request because a body was malformed.
   */
  keyOn?: (req: Request) => string | undefined;
  /**
   * Drops the per-IP component from the key entirely, sharing one counter
   * across every caller — a hard ceiling on total volume through a route,
   * independent of how many source IPs it's spread across. Hard Audit
   * finding, 2026-08-27: publicAnalytics's per-IP-only limiter meant a
   * modest botnet (or rotating proxy), each individually under the per-IP
   * cap, had no aggregate throttle on total write volume. Use alongside
   * the existing per-IP limiter (a second rateLimit() call), not instead
   * of it — this catches distributed volume, the per-IP one catches a
   * single abusive source.
   */
  global?: boolean;
}

export function rateLimit(opts: RateLimitOptions) {
  return function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
    let extra = "";
    try {
      extra = String(opts.keyOn?.(req) || "").trim().toLowerCase();
    } catch {
      extra = "";
    }
    const key = opts.global ? `${opts.name}:__global__:${extra}` : `${opts.name}:${clientKey(req)}:${extra}`;
    const now = Date.now();

    let hit = buckets.get(key);
    if (!hit || hit.resetAt <= now) {
      hit = { count: 0, resetAt: now + opts.windowMs };
      buckets.set(key, hit);
    }
    hit.count += 1;

    if (hit.count > opts.max) {
      const retryAfter = Math.max(1, Math.ceil((hit.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfter));
      res.status(429).json({
        error: `Too many attempts. Please wait ${retryAfter > 60 ? `${Math.ceil(retryAfter / 60)} minutes` : `${retryAfter} seconds`} and try again.`,
      });
      return;
    }
    next();
  };
}

/** Exposed for tests/diagnostics — never call from request handling. */
export function __resetRateLimits(): void {
  buckets.clear();
}
