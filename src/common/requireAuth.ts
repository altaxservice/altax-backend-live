import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { pool } from "../config/db";
import { PortalRole } from "../modules/auth/auth.service";

export interface AuthedRequest extends Request {
  user?: { sub: string; role: PortalRole; email: string; clientId?: string; employeeId?: string; tv?: number };
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
 *
 * Also carries token_version for the same reason: a token's role/clientId/
 * employeeId claims are baked in at login and otherwise trusted for the
 * token's full life. Hard Audit finding, 2026-08-27 — ownership transfer
 * reprovisions a client portal login for a new owner (same user_id, new
 * clientId) while the seller's still-live token kept working against the
 * old clientId, since nothing re-checked it against the database. Bumping
 * token_version invalidates every outstanding token for that user via the
 * same cache/instant-bust mechanism already used for `active`.
 */
const ACTIVE_CACHE_TTL_MS = 3 * 60 * 1000;
const activeCache = new Map<string, { active: boolean; tokenVersion: number; expiresAt: number }>();

export function invalidateActiveCache(userId: string): void {
  activeCache.delete(userId);
}

async function getAuthState(userId: string): Promise<{ active: boolean; tokenVersion: number }> {
  const cached = activeCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached;
  const { rows } = await pool.query(`SELECT active, token_version FROM altax.v3_users WHERE user_id = $1`, [userId]);
  // No matching row (deleted outright, not just deactivated) fails closed,
  // same as an explicit active = false.
  const active = rows.length > 0 && rows[0].active !== false;
  const tokenVersion = rows.length > 0 ? Number(rows[0].token_version) || 0 : 0;
  const state = { active, tokenVersion, expiresAt: Date.now() + ACTIVE_CACHE_TTL_MS };
  activeCache.set(userId, state);
  return state;
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

  getAuthState(payload!.sub)
    .then(({ active, tokenVersion }) => {
      if (!active) return res.status(401).json({ error: "This account has been deactivated." });
      // A token issued before this column existed carries no `tv` claim —
      // treat that as version 0 (this column's default) so nothing already
      // issued is broken by the migration; only a version bump after issuance
      // (role/client reassignment, ownership transfer) invalidates it.
      if ((payload!.tv || 0) !== tokenVersion) {
        return res.status(401).json({ error: "Invalid or expired session." });
      }
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
