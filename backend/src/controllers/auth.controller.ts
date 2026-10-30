import type { Request, Response, NextFunction } from "express";
import { login, type AuthConfig } from "../services/auth.service.js";
import { parseLoginBody } from "../validation/auth.validation.js";

export function createLoginHandler(config: AuthConfig) {
  return async function loginHandler(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const { email, password } = parseLoginBody(req.body);
      const result = await login(email, password, config);

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };
}
