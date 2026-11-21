import type { Prisma } from "../../generated/prisma/client.js";
import type {
  PaymentStatus,
  ProjectStatus,
  Role,
  TaskStatus,
} from "../../generated/prisma/enums.js";
import { CACHE_TTL, cached, cacheKeys } from "../../lib/cache.js";
import { lockRow, prisma, TX_OPTIONS } from "../../lib/prisma.js";
import type { AuthUser } from "../../middlewares/auth.js";
import { AppError } from "../../utils/AppError.js";
import { writeAuditLog } from "../../utils/audit.js";
import { buildMeta, toSkipTake } from "../../utils/pagination.js";
import { PRO_PLAN } from "../../utils/plan.js";
import { userSummarySelect } from "../users/users.select.js";
import type {
  ChangeRoleBody,
  ChangeStatusBody,
  ListAuditLogsQuery,
  ListUsersQuery,
} from "./admin.validation.js";

const adminUserSelect = {
  ...userSummarySelect,
  plan: true,
  planExpiresAt: true,
  updatedAt: true,
  _count: {
    select: {
      ownedProjects: { where: { deletedAt: null } },
      memberships: { where: { removedAt: null, project: { deletedAt: null } } },
    },
  },
} as const satisfies Prisma.UserSelect;

type AdminUserRow = Prisma.UserGetPayload<{ select: typeof adminUserSelect }>;

function toAdminUser({ _count, ...user }: AdminUserRow) {
  return { ...user, ownedProjects: _count.ownedProjects, activeMemberships: _count.memberships };
}

async function getAdminUser(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: adminUserSelect,
  });
  return toAdminUser(user);
}

/** GET /admin/users – search by name or email, filter by role/status, sort, paginate. */
export async function listUsers(query: ListUsersQuery) {
  const where: Prisma.UserWhereInput = {
    ...(query.role ? { role: query.role } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: "insensitive" } },
            { email: { contains: query.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: adminUserSelect,
      orderBy: [{ [query.sortBy]: query.sortOrder }, { id: "asc" }],
      ...toSkipTake(query.page, query.limit),
    }),
    prisma.user.count({ where }),
  ]);
  return { users: rows.map(toAdminUser), meta: buildMeta(query.page, query.limit, total) };
}

/** BR-23: only MANAGER ↔ MEMBER, never your own role, never an admin, no orphaned data. */
export async function changeUserRole(admin: AuthUser, userId: string, { role }: ChangeRoleBody) {
  if (userId === admin.id) {
    throw new AppError(409, "You cannot change your own role");
  }

  const changed = await prisma.$transaction(async (tx) => {
    // Same lock as project creation, so "demote" and "create project" cannot overlap.
    await lockRow(tx, "users", userId);
    const target = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    });
    if (!target) {
      throw new AppError(404, "User not found");
    }
    if (target.role === "ADMIN") {
      throw new AppError(409, "Admin accounts cannot be changed through the API");
    }
    if (target.role === role) {
      return false;
    }

    if (target.role === "MANAGER") {
      const owned = await tx.project.count({ where: { ownerId: userId, deletedAt: null } });
      if (owned > 0) {
        throw new AppError(
          409,
          `This manager still owns ${owned} project(s). Delete them before making the user a MEMBER.`,
        );
      }
    } else {
      const memberships = await tx.projectMember.count({
        where: { userId, removedAt: null, project: { deletedAt: null } },
      });
      if (memberships > 0) {
        throw new AppError(
          409,
          `This member is still in ${memberships} project(s). Remove them before making the user a MANAGER.`,
        );
      }
    }

    await tx.user.update({ where: { id: userId }, data: { role }, select: { id: true } });
    await writeAuditLog(tx, {
      actorId: admin.id,
      action: "USER_ROLE_CHANGED",
      entityType: "USER",
      entityId: userId,
      metadata: { from: target.role, to: role },
    });
    return true;
  }, TX_OPTIONS);

  return { user: await getAdminUser(userId), changed };
}

/** BR-24: block/unblock; never yourself or another admin. Blocking ends all sessions. */
export async function changeUserStatus(
  admin: AuthUser,
  userId: string,
  { status }: ChangeStatusBody,
) {
  if (userId === admin.id) {
    throw new AppError(409, "You cannot block or unblock yourself");
  }

  const result = await prisma.$transaction(async (tx) => {
    await lockRow(tx, "users", userId);
    const target = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, status: true },
    });
    if (!target) {
      throw new AppError(404, "User not found");
    }
    if (target.role === "ADMIN") {
      throw new AppError(409, "Admin accounts cannot be blocked");
    }
    if (target.status === status) {
      return { changed: false, revokedSessions: 0 };
    }

    await tx.user.update({ where: { id: userId }, data: { status }, select: { id: true } });
    let revokedSessions = 0;
    if (status === "BLOCKED") {
      const { count } = await tx.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      revokedSessions = count;
    }
    await writeAuditLog(tx, {
      actorId: admin.id,
      action: "USER_STATUS_CHANGED",
      entityType: "USER",
      entityId: userId,
      metadata: { from: target.status, to: status, revokedSessions },
    });
    return { changed: true, revokedSessions };
  }, TX_OPTIONS);

  return { user: await getAdminUser(userId), ...result };
}

/** Counts only (groupBy / count / aggregate), never full lists. */
async function computeDashboardStats() {
  const now = new Date();
  const liveTask: Prisma.TaskWhereInput = { deletedAt: null, project: { deletedAt: null } };

  const [
    usersByRole,
    blockedUsers,
    projectsByStatus,
    tasksByStatus,
    overdueTasks,
    paymentsByStatus,
    revenue,
    activeProManagers,
  ] = await Promise.all([
    prisma.user.groupBy({ by: ["role"], _count: { _all: true } }),
    prisma.user.count({ where: { status: "BLOCKED" } }),
    prisma.project.groupBy({ by: ["status"], where: { deletedAt: null }, _count: { _all: true } }),
    prisma.task.groupBy({ by: ["status"], where: liveTask, _count: { _all: true } }),
    prisma.task.count({
      where: { ...liveTask, status: { not: "DONE" }, dueDate: { lt: now } },
    }),
    prisma.payment.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.payment.aggregate({ where: { status: "PAID" }, _sum: { amount: true } }),
    prisma.user.count({ where: { role: "MANAGER", plan: "PRO", planExpiresAt: { gt: now } } }),
  ]);

  const byRole: Record<Role, number> = { ADMIN: 0, MANAGER: 0, MEMBER: 0 };
  for (const row of usersByRole) byRole[row.role] = row._count._all;

  const byProjectStatus: Record<ProjectStatus, number> = { ACTIVE: 0, ARCHIVED: 0 };
  for (const row of projectsByStatus) byProjectStatus[row.status] = row._count._all;

  const byTaskStatus: Record<TaskStatus, number> = {
    TODO: 0,
    IN_PROGRESS: 0,
    IN_REVIEW: 0,
    DONE: 0,
  };
  for (const row of tasksByStatus) byTaskStatus[row.status] = row._count._all;

  const byPaymentStatus: Record<PaymentStatus, number> = {
    PENDING: 0,
    PAID: 0,
    FAILED: 0,
    CANCELLED: 0,
  };
  for (const row of paymentsByStatus) byPaymentStatus[row.status] = row._count._all;

  const sum = (counts: Record<string, number>) =>
    Object.values(counts).reduce((total, value) => total + value, 0);

  return {
    users: { total: sum(byRole), byRole, blocked: blockedUsers },
    projects: { total: sum(byProjectStatus), ...byProjectStatus },
    tasks: { total: sum(byTaskStatus), byStatus: byTaskStatus, overdue: overdueTasks },
    payments: {
      byStatus: byPaymentStatus,
      revenue: revenue._sum.amount?.toFixed(2) ?? "0.00",
      currency: PRO_PLAN.currency,
    },
    subscriptions: { activeProManagers },
    generatedAt: now.toISOString(),
  };
}

/** GET /admin/stats – cached for 60 seconds when Redis is configured. */
export function getDashboardStats() {
  return cached(cacheKeys.adminStats, CACHE_TTL.adminStats, computeDashboardStats);
}

/** GET /admin/audit-logs – who changed what, newest first by default. */
export async function listAuditLogs(query: ListAuditLogsQuery) {
  const createdAt: Prisma.DateTimeFilter = {
    ...(query.from ? { gte: query.from } : {}),
    ...(query.to ? { lte: query.to } : {}),
  };
  const where: Prisma.AuditLogWhereInput = {
    ...(query.action ? { action: query.action } : {}),
    ...(query.entityType ? { entityType: query.entityType } : {}),
    ...(query.entityId ? { entityId: query.entityId } : {}),
    ...(query.actorId ? { actorId: query.actorId } : {}),
    ...(query.from || query.to ? { createdAt } : {}),
  };

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        metadata: true,
        createdAt: true,
        actor: { select: { id: true, name: true, email: true, role: true } },
      },
      orderBy: [{ createdAt: query.sortOrder }, { id: query.sortOrder }],
      ...toSkipTake(query.page, query.limit),
    }),
    prisma.auditLog.count({ where }),
  ]);
  return { logs, meta: buildMeta(query.page, query.limit, total) };
}
