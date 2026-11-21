import { z } from "zod";
import type { PaginationMeta } from "./sendResponse.js";

export const DEFAULT_LIMIT = 10;
export const MAX_LIMIT = 100;

/** `page` (default 1) and `limit` (default 10, max 100) from the query string. */
export const paginationFields = {
  page: z.coerce
    .number({ error: "page must be a number" })
    .int("page must be a whole number")
    .min(1, "page must be at least 1")
    .default(1),
  limit: z.coerce
    .number({ error: "limit must be a number" })
    .int("limit must be a whole number")
    .min(1, "limit must be at least 1")
    .max(MAX_LIMIT, `limit must be at most ${MAX_LIMIT}`)
    .default(DEFAULT_LIMIT),
};

/** `sortBy` limited to the given fields, plus `sortOrder` (asc or desc). */
export function sortFields<const T extends readonly [string, ...string[]]>(
  allowed: T,
  defaults: { sortBy: T[number]; sortOrder: "asc" | "desc" },
) {
  return {
    sortBy: z
      .enum(allowed, { error: `sortBy must be one of: ${allowed.join(", ")}` })
      .default(defaults.sortBy as never),
    sortOrder: z
      .enum(["asc", "desc"], { error: "sortOrder must be asc or desc" })
      .default(defaults.sortOrder),
  };
}

/** Optional search text; an empty value counts as "no search". */
export const searchField = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().max(100, "search must be at most 100 characters").optional(),
);

/** `?overdue=true` → true. Anything other than "true"/"false" is a validation error. */
export const booleanFlag = z
  .enum(["true", "false"], { error: "Use true or false" })
  .transform((value) => value === "true")
  .optional();

export function toSkipTake(page: number, limit: number) {
  return { skip: (page - 1) * limit, take: limit };
}

export function buildMeta(page: number, limit: number, total: number): PaginationMeta {
  return { page, limit, total, totalPages: Math.ceil(total / limit) };
}
