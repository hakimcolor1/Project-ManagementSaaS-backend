import type { Request, Response } from "express";
import { getCurrentUser } from "../../middlewares/auth.js";
import { sendResponse } from "../../utils/sendResponse.js";
import * as adminService from "./admin.service.js";
import type {
  ChangeRoleBody,
  ChangeStatusBody,
  ListAuditLogsQuery,
  ListUsersQuery,
} from "./admin.validation.js";

/** GET /api/v1/admin/users */
export async function listUsers(req: Request, res: Response) {
  const { users, meta } = await adminService.listUsers(req.query as unknown as ListUsersQuery);
  sendResponse(res, { message: "Users retrieved", data: users, meta });
}

/** PATCH /api/v1/admin/users/:id/role */
export async function changeUserRole(req: Request, res: Response) {
  const result = await adminService.changeUserRole(
    getCurrentUser(req),
    String(req.params.id),
    req.body as ChangeRoleBody,
  );
  sendResponse(res, {
    message: result.changed ? "Role updated" : "The user already has this role",
    data: result,
  });
}

/** PATCH /api/v1/admin/users/:id/status */
export async function changeUserStatus(req: Request, res: Response) {
  const result = await adminService.changeUserStatus(
    getCurrentUser(req),
    String(req.params.id),
    req.body as ChangeStatusBody,
  );
  sendResponse(res, {
    message: result.changed
      ? result.user.status === "BLOCKED"
        ? "User blocked"
        : "User unblocked"
      : "The user already has this status",
    data: result,
  });
}

/** GET /api/v1/admin/stats */
export async function getStats(_req: Request, res: Response) {
  const stats = await adminService.getDashboardStats();
  sendResponse(res, { message: "Dashboard stats retrieved", data: stats });
}

/** GET /api/v1/admin/audit-logs */
export async function listAuditLogs(req: Request, res: Response) {
  const { logs, meta } = await adminService.listAuditLogs(
    req.query as unknown as ListAuditLogsQuery,
  );
  sendResponse(res, { message: "Audit logs retrieved", data: logs, meta });
}
