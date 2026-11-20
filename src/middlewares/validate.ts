import type { RequestHandler } from "express";
import type { z } from "zod";
import { AppError, type ErrorDetail } from "../utils/AppError.js";

/** Turns Zod issues into [{ field, message }]. The first path part (body/params/query) is dropped. */
export function toErrorDetails(error: z.ZodError): ErrorDetail[] {
  return error.issues.flatMap((issue) => {
    const [location, ...rest] = issue.path;
    const field = rest.map(String).join(".");

    if (issue.code === "unrecognized_keys") {
      return issue.keys.map((key) => ({
        field: field ? `${field}.${key}` : key,
        message: `Unknown field "${key}"`,
      }));
    }
    return [{ field: field || String(location ?? "request"), message: issue.message }];
  });
}

/**
 * Validates req.body / req.params / req.query with one Zod schema shaped like
 * z.object({ body, params, query }), then replaces them with the parsed values
 * (trimmed strings, defaults, numbers from query strings).
 */
export function validate(schema: z.ZodObject): RequestHandler {
  const parts = new Set(Object.keys(schema.shape));

  return (req, _res, next) => {
    const result = schema.safeParse({
      body: req.body ?? {},
      params: req.params,
      query: req.query,
    });

    if (!result.success) {
      throw new AppError(400, "Validation failed", toErrorDetails(result.error));
    }

    const data = result.data as { body?: unknown; params?: unknown; query?: unknown };
    if (parts.has("body")) {
      req.body = data.body;
    }
    if (parts.has("params")) {
      req.params = data.params as typeof req.params;
    }
    if (parts.has("query")) {
      // In Express 5 req.query is a getter, so it is shadowed with the parsed value.
      Object.defineProperty(req, "query", {
        value: data.query,
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }
    next();
  };
}
