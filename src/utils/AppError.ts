export type ErrorDetail = { field?: string; message: string };

/**
 * An expected error with an HTTP status code. Throw it anywhere (services, middlewares);
 * the global error handler turns it into { success: false, message, errors }.
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly errors: ErrorDetail[];

  constructor(statusCode: number, message: string, errors: ErrorDetail[] = []) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.errors = errors;
  }
}
