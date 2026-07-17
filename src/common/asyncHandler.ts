import { NextFunction, Request, Response } from "express";

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
