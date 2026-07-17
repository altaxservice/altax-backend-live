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
    req.user = jwt.verify(token, process.env.JWT_SECRET as string) as AuthedRequest["user"];
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
