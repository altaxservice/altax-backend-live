import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { PortalRole } from "../modules/auth/auth.service";

export interface AuthedRequest extends Request {
  user?: { sub: string; role: PortalRole; email: string; clientId?: string; employeeId?: string };
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing authentication token." });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET as string) as AuthedRequest["user"] & { purpose?: string };
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
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired session." });
  }
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
