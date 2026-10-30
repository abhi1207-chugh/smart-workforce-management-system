export type ErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "CONFLICT"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "INTERNAL_ERROR";

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;
  readonly details: unknown[];

  constructor(
    statusCode: number,
    code: ErrorCode,
    message: string,
    details: unknown[] = []
  ) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function badRequest(message: string, details: unknown[] = []): AppError {
  return new AppError(400, "VALIDATION_ERROR", message, details);
}

export function notFound(message: string): AppError {
  return new AppError(404, "NOT_FOUND", message);
}

export function conflict(message: string): AppError {
  return new AppError(409, "CONFLICT", message);
}

export function unauthorized(message = "Authentication required"): AppError {
  return new AppError(401, "UNAUTHORIZED", message);
}

export function forbidden(message = "You do not have permission to do this"): AppError {
  return new AppError(403, "FORBIDDEN", message);
}

export function internalError(message = "An unexpected error occurred"): AppError {
  return new AppError(500, "INTERNAL_ERROR", message);
}
