import { Router } from "express";
import { auth } from "../../middlewares/auth.js";
import { authorize } from "../../middlewares/authorize.js";
import { validate } from "../../middlewares/validate.js";
import {
  changeUserRole,
  changeUserStatus,
  getStats,
  listAuditLogs,
  listUsers,
} from "./admin.controller.js";
import {
  changeRoleSchema,
  changeStatusSchema,
  listAuditLogsSchema,
  listUsersSchema,
} from "./admin.validation.js";

export const adminRoutes = Router();

// Every admin route: logged in (401) and ADMIN (403).
adminRoutes.use(auth, authorize("ADMIN"));

adminRoutes.get("/users", validate(listUsersSchema), listUsers);
adminRoutes.patch("/users/:id/role", validate(changeRoleSchema), changeUserRole);
adminRoutes.patch("/users/:id/status", validate(changeStatusSchema), changeUserStatus);
adminRoutes.get("/stats", getStats);
adminRoutes.get("/audit-logs", validate(listAuditLogsSchema), listAuditLogs);
