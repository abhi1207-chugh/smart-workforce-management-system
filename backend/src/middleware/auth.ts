import type { Request, Response, NextFunction, RequestHandler } from "express";
import { verifyToken } from "../auth/token.js";
import type { AuthUser, UserRole } from "../auth/types.js";
import { forbidden, unauthorized } from "../errors/app-error.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by `authenticate` after the bearer token has been verified. */
      user?: AuthUser;
    }
  }
}

/** Requires `Authorization: Bearer <jwt>`; attaches `req.user` or responds 401. */
export function createAuthenticate(jwtSecret: string): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const header = req.headers.authorization;
      if (!header) {
        throw unauthorized();
      }

      const [scheme, token, ...rest] = header.split(" ");
      if (scheme !== "Bearer" || !token || rest.length > 0) {
        throw unauthorized("Authorization header must be: Bearer <token>");
      }

      req.user = verifyToken(token, jwtSecret);
      next();
    } catch (error) {
      next(error);
    }
  };
}

/** Must run after `authenticate`. Responds 403 unless the user has one of `roles`. */
export function requireRole(...roles: UserRole[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(unauthorized());
      return;
    }
    if (!roles.includes(req.user.role)) {
      next(forbidden());
      return;
    }
    next();
  };
}
