import { NextFunction, Request, Response } from "express";

/**
 * Marks an error's message as deliberately written for the client to see —
 * "Contractor not found," "Invoice total must be greater than zero," etc.
 * Several routes wrap a whole DB transaction (validation checks plus real
 * INSERT/UPDATE calls) in one try/catch and used to forward err.message to
 * the client no matter which threw it, which meant a genuine Postgres error
 * (raw column/constraint/table names) could leak out right alongside the
 * intentional validation messages. Throw this for anything meant to reach
 * the client; catch blocks check `instanceof ValidationError` before using
 * `.message` and re-throw everything else so the global error handler in
 * server.ts returns its normal generic message instead. Hard Audit finding,
 * 2026-08-29 — highest severity on the one public, unauthenticated route
 * that had this gap (publicAppointments.routes.ts's booking endpoint).
 */
export class ValidationError extends Error {}

/**
 * Wraps an async Express route handler so a rejected promise reaches next(err)
 * instead of hanging the request forever. Express 4 does not do this on its own —
 * confirmed live: an unhandled DB connection error inside a route handler left the
 * client with an empty response and no status code at all, with the only trace in
 * the server's own logs.
 */
export function asyncHandler<Req extends Request = Request>(
  handler: (req: Req, res: Response, next: NextFunction) => Promise<any>
) {
  return (req: Req, res: Response, next: NextFunction) => {
    handler(req, res, next).catch(next);
  };
}
