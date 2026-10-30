import jwt, { type SignOptions } from "jsonwebtoken";
import { unauthorized } from "../errors/app-error.js";
import type { AuthUser, UserRole } from "./types.js";

interface TokenPayload {
  sub: string;
  email: string;
  role: UserRole;
  employee_id: string | null;
}

export function signToken(
  user: AuthUser,
  secret: string,
  expiresIn: string
): string {
  const payload: TokenPayload = {
    sub: user.id,
    email: user.email,
    role: user.role,
    employee_id: user.employee_id,
  };

  return jwt.sign(payload, secret, {
    algorithm: "HS256",
    expiresIn: expiresIn as SignOptions["expiresIn"],
  });
}

/** Verifies signature and expiry. Throws a 401 AppError if invalid. */
export function verifyToken(token: string, secret: string): AuthUser {
  try {
    const decoded = jwt.verify(token, secret, { algorithms: ["HS256"] });

    if (
      typeof decoded === "string" ||
      typeof decoded.sub !== "string" ||
      typeof decoded.email !== "string" ||
      (decoded.role !== "ADMIN" && decoded.role !== "EMPLOYEE")
    ) {
      throw unauthorized("Invalid token");
    }

    return {
      id: decoded.sub,
      email: decoded.email,
      role: decoded.role,
      employee_id: (decoded.employee_id as string | null | undefined) ?? null,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AppError") throw error;
    throw unauthorized("Invalid or expired token");
  }
}
