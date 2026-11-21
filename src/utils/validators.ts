import { z } from "zod";

/** A UUID route parameter or body field. A bad ID is a 400, never a database error. */
export const uuidField = (name = "id") => z.uuid({ error: `${name} must be a valid UUID` });

/**
 * A due date in ISO 8601: a full date-time ("2026-12-31T18:00:00Z") or a plain date
 * ("2026-12-31", read as the end of that day in UTC). It cannot be in the past (BR-16).
 */
export const dueDateField = z
  .union([z.iso.datetime({ offset: true }), z.iso.date()], {
    error: "dueDate must be an ISO 8601 date, for example 2026-12-31 or 2026-12-31T18:00:00Z",
  })
  .transform((value) =>
    value.length === 10 ? new Date(`${value}T23:59:59.999Z`) : new Date(value),
  )
  .refine((date) => date.getTime() > Date.now(), { error: "dueDate cannot be in the past" });

/** Optional longer text; an empty string clears it (null). */
export const optionalText = (name: string, max: number) =>
  z
    .string({ error: `${name} must be text` })
    .trim()
    .max(max, `${name} must be at most ${max} characters`)
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .optional();

/** At least one field must be sent in a PATCH body. */
export const notEmpty = (fields: string) => ({
  error: `Send at least one field to update: ${fields}`,
});

export const hasAnyKey = (body: object) => Object.keys(body).length > 0;
