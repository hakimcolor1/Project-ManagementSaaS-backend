import type { ErrorRequestHandler } from "express";
import { Prisma } from "../generated/prisma/client.js";
import { AppError, type ErrorDetail } from "../utils/AppError.js";

type NormalizedError = { statusCode: number; message: string; errors: ErrorDetail[] };

/** Errors from Express's body parser carry an HTTP status and a type. */
function isHttpError(error: unknown): error is { status: number; type?: string; message: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { status?: unknown }).status === "number"
  );
}

function normalizeError(error: unknown): NormalizedError {
  if (error instanceof AppError) {
    return { statusCode: error.statusCode, message: error.message, errors: error.errors };
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    switch (error.code) {
      case "P2002": // unique constraint
        return { statusCode: 409, message: "A record with this value already exists", errors: [] };
      case "P2025": // record to update/delete not found
        return { statusCode: 404, message: "Record not found", errors: [] };
      case "P2003": // foreign key
        return { statusCode: 400, message: "A related record does not exist", errors: [] };
    }
  }

  if (isHttpError(error)) {
    if (error.type === "entity.parse.failed") {
      return { statusCode: 400, message: "Malformed JSON in request body", errors: [] };
    }
    if (error.type === "entity.too.large") {
      return { statusCode: 413, message: "Request body is too large", errors: [] };
    }
    if (error.status >= 400 && error.status < 500) {
      return { statusCode: error.status, message: error.message, errors: [] };
    }
  }

  return { statusCode: 500, message: "Something went wrong", errors: [] };
}

/** Last middleware: every error leaves the API as { success: false, message, errors }. */
export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  const { statusCode, message, errors } = normalizeError(error);

  if (statusCode >= 500) {
    // Server-side log only; the client never sees stack traces or internal details.
    if (error instanceof AppError) {
      // Expected (e.g. 502/503 from the payment gateway): one line is enough.
      console.warn(`[error] ${req.method} ${req.path} → ${statusCode} ${message}`);
    } else {
      console.error(`[error] ${req.method} ${req.originalUrl}`, error);
    }
  }

  res.status(statusCode).json({ success: false, message, errors });
};
