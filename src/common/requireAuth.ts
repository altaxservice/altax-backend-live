import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { pool } from "../config/db";
import { PortalRole } from "../modules/auth/auth.service";

export interface AuthedRequest extends Request {
  user?: { sub: string; role: PortalRole; email: string; clientId?: string; employeeId?: string };
}

/**
 * A deactivated user's already-issued JWT used to keep working for up to its
 * full 8-hour expiry — requireAuth only ever verified the token's signature,
 * never re-checked whether the v3_users row it points at was still active.
 * Cached rather than queried on every request (that would add a DB round-trip
 * to every single authenticated call in the app); a few minutes of staleness
 * is the deliberate tradeoff so a just-deactivated user is locked out within
 * minutes, not instantly — invalidateActiveCache() below shortens that to
 * "immediately" for the one call site that actually deactivates someone.
 */
const ACTIVE_CACHE_TTL_MS = 3 * 60 * 1000;
const activeCache = new Map<string, { active: boolean; expiresAt: number }>();

export function invalidateActiveCache(userId: string): void {
  activeCache.delete(userId);
}

async function isUserStillActive(userId: string): Promise<boolean> {
  const cached = activeCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.active;
  const { rows } = await pool.query(`SELECT active FROM altax.v3_users WHERE user_id = $1`, [userId]);
  // No matching row (deleted outright, not just deactivated) fails closed,
  // same as an explicit active = false.
  const active = rows.length > 0 && rows[0].active !== false;
  activeCache.set(userId, { active, expiresAt: Date.now() + ACTIVE_CACHE_TTL_MS });
  return active;
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing authentication token." });

  let payload: (AuthedRequest["user"] & { purpose?: string }) | undefined;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET as string) as AuthedRequest["user"] & { purpose?: string };
  } catch {
    return res.status(401).json({ error: "Invalid or expired session." });
  }
  // Login issues several short-lived, single-purpose tokens before a real
  // session exists (2fa-challenge, 2fa-enroll, email-otp — see
  // auth.routes.ts's readChallenge()), all signed with the same JWT_SECRET
  // and all carrying the same `sub`. A real session token never has a
  // `purpose` claim, so one of these narrowly-scoped tokens must never pass
  // as a full session here — otherwise a 2fa-challenge token (which only
  // requires knowing the password, not the second factor) could be handed
  // to any requireAuth-only route, e.g. POST /auth/2fa/setup, letting an
  // attacker overwrite the real account's TOTP secret before ever proving
  // they hold it.
  if (payload?.purpose) return res.status(401).json({ error: "Invalid or expired session." });

  isUserStillActive(payload!.sub)
    .then((active) => {
      if (!active) return res.status(401).json({ error: "This account has been deactivated." });
      req.user = payload;
      next();
    })
    .catch(next);
}

/**
 * Enforces role-based access on the SERVER, not just by hiding nav in the UI —
 * closes the gap noted in the migration plan (Section 8.3) where a portal-locked
 * link today relies on client-side JS to hide navigation.
 */
export function requireRole(...allowed: PortalRole[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.user || !allowed.includes(req.user.role)) {
      return res.status(403).json({ error: "You do not have access to this resource." });
    }
    next();
  };
}
