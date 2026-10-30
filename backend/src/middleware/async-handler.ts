import type { Request, Response, NextFunction, RequestHandler } from "express";

/** Forwards errors from an async handler to the Express error handler. */
export function asyncHandler(
  handler: (req: Request, res: Response) => Promise<void>
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res).catch(next);
  };
}
