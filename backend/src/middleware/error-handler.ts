import type { Request, Response, NextFunction } from "express";
import { AppError, badRequest, conflict, internalError } from "../errors/app-error.js";
import { DatabaseError } from "pg";

function mapKnownDatabaseError(error: DatabaseError): AppError | null {
  switch (error.code) {
    case "P0001":
      return conflict(error.message);
    case "23505":
      return conflict("A conflicting record already exists");
    case "23503":
      return badRequest("A referenced record does not exist or is still in use");
    case "23514":
      return badRequest("The data violates a database constraint");
    default:
      return null;
  }
}

export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (error instanceof AppError) {
    res.status(error.statusCode).json({
      success: false,
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
      },
    });
    return;
  }

  if (error instanceof DatabaseError) {
    // Business rules raised by SQL functions/triggers (RAISE EXCEPTION) are
    // meant for clients; other constraint failures get a generic message.
    const mapped = mapKnownDatabaseError(error);
    if (mapped) {
      res.status(mapped.statusCode).json({
        success: false,
        error: { code: mapped.code, message: mapped.message, details: [] },
      });
      return;
    }
    console.error("Database error:", {
      code: error.code,
      message: error.message,
    });
    const appError = internalError("A database error occurred");
    res.status(appError.statusCode).json({
      success: false,
      error: {
        code: appError.code,
        message: appError.message,
        details: [],
      },
    });
    return;
  }

  console.error("Unhandled error:", error);
  const appError = internalError();
  res.status(appError.statusCode).json({
    success: false,
    error: {
      code: appError.code,
      message: appError.message,
      details: [],
    },
  });
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({
    success: false,
    error: {
      code: "NOT_FOUND",
      message: "Route not found",
      details: [],
    },
  });
}
