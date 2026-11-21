import { z } from "zod";
import { AuditAction, AuditEntity } from "../../generated/prisma/enums.js";
import { paginationFields, searchField, sortFields } from "../../utils/pagination.js";
import { uuidField } from "../../utils/validators.js";

const userParams = z.strictObject({ id: uuidField("User id") });

export const listUsersSchema = z.object({
  query: z.strictObject({
    ...paginationFields,
    ...sortFields(["createdAt", "name", "email"], { sortBy: "createdAt", sortOrder: "desc" }),
    search: searchField,
    role: z
      .enum(["ADMIN", "MANAGER", "MEMBER"], { error: "role must be ADMIN, MANAGER or MEMBER" })
      .optional(),
    status: z.enum(["ACTIVE", "BLOCKED"], { error: "status must be ACTIVE or BLOCKED" }).optional(),
  }),
});

/** Only MANAGER ↔ MEMBER. ADMIN accounts come from the seed script (BR-23). */
export const changeRoleSchema = z.object({
  params: userParams,
  body: z.strictObject({
    role: z.enum(["MANAGER", "MEMBER"], { error: "role must be MANAGER or MEMBER" }),
  }),
});

export const changeStatusSchema = z.object({
  params: userParams,
  body: z.strictObject({
    status: z.enum(["ACTIVE", "BLOCKED"], { error: "status must be ACTIVE or BLOCKED" }),
  }),
});

/** Full ISO date-time, or a plain date: `from` = start of that day, `to` = end of it (UTC). */
const dateFilter = (edge: "start" | "end") =>
  z
    .union([z.iso.datetime({ offset: true }), z.iso.date()], {
      error: "Use an ISO 8601 date, for example 2026-11-20 or 2026-11-20T10:00:00Z",
    })
    .transform((value) =>
      value.length === 10
        ? new Date(`${value}T${edge === "start" ? "00:00:00.000" : "23:59:59.999"}Z`)
        : new Date(value),
    );

export const listAuditLogsSchema = z.object({
  query: z
    .strictObject({
      ...paginationFields,
      sortOrder: z
        .enum(["asc", "desc"], { error: "sortOrder must be asc or desc" })
        .default("desc"),
      action: z.enum(AuditAction, { error: "action is not a known audit action" }).optional(),
      entityType: z
        .enum(AuditEntity, { error: "entityType must be USER, PROJECT, TASK or PAYMENT" })
        .optional(),
      entityId: uuidField("entityId").optional(),
      actorId: uuidField("actorId").optional(),
      from: dateFilter("start").optional(),
      to: dateFilter("end").optional(),
    })
    .refine((query) => !query.from || !query.to || query.from <= query.to, {
      error: "from must not be after to",
      path: ["from"],
    }),
});

export type ListUsersQuery = z.infer<typeof listUsersSchema>["query"];
export type ChangeRoleBody = z.infer<typeof changeRoleSchema>["body"];
export type ChangeStatusBody = z.infer<typeof changeStatusSchema>["body"];
export type ListAuditLogsQuery = z.infer<typeof listAuditLogsSchema>["query"];
