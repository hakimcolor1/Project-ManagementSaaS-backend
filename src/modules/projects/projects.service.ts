import type { Prisma } from "../../generated/prisma/client.js";
import type { TaskStatus } from "../../generated/prisma/enums.js";
import { CACHE_TTL, cacheDelete, cached, cacheKeys } from "../../lib/cache.js";
import { prisma, TX_OPTIONS } from "../../lib/prisma.js";
import type { AuthUser } from "../../middlewares/auth.js";
import { AppError } from "../../utils/AppError.js";
import { writeAuditLog } from "../../utils/audit.js";
import { buildMeta, toSkipTake } from "../../utils/pagination.js";
import { assertActiveProjectSlot, findOwnedProject, projectScope } from "./projects.access.js";
import type {
  CreateProjectBody,
  ListProjectsQuery,
  UpdateProjectBody,
} from "./projects.validation.js";

const projectSelect = {
  id: true,
  name: true,
  description: true,
  status: true,
  dueDate: true,
  createdAt: true,
  updatedAt: true,
  owner: { select: { id: true, name: true, email: true } },
  _count: {
    select: {
      members: { where: { removedAt: null } },
      tasks: { where: { deletedAt: null } },
    },
  },
} as const satisfies Prisma.ProjectSelect;

type ProjectRow = Prisma.ProjectGetPayload<{ select: typeof projectSelect }>;

function toProject({ _count, ...project }: ProjectRow) {
  return { ...project, memberCount: _count.members, taskCount: _count.tasks };
}

export type ProjectStats = {
  totalTasks: number;
  tasksByStatus: Record<TaskStatus, number>;
  overdueTasks: number;
  progressPercent: number;
  memberCount: number;
};

/** Task counts per status, overdue tasks, progress % and members, using counts only. */
async function computeProjectStats(projectId: string): Promise<ProjectStats> {
  const [byStatus, overdueTasks, memberCount] = await Promise.all([
    prisma.task.groupBy({
      by: ["status"],
      where: { projectId, deletedAt: null },
      _count: { _all: true },
    }),
    prisma.task.count({
      where: { projectId, deletedAt: null, status: { not: "DONE" }, dueDate: { lt: new Date() } },
    }),
    prisma.projectMember.count({ where: { projectId, removedAt: null } }),
  ]);

  const tasksByStatus: Record<TaskStatus, number> = {
    TODO: 0,
    IN_PROGRESS: 0,
    IN_REVIEW: 0,
    DONE: 0,
  };
  for (const row of byStatus) {
    tasksByStatus[row.status] = row._count._all;
  }
  const totalTasks = Object.values(tasksByStatus).reduce((sum, count) => sum + count, 0);
  const progressPercent =
    totalTasks === 0 ? 0 : Math.round((tasksByStatus.DONE / totalTasks) * 100);

  return { totalTasks, tasksByStatus, overdueTasks, progressPercent, memberCount };
}

/** Clears the cached stats of a project. Call it after the change has been committed. */
export function invalidateProjectStats(projectId: string): Promise<void> {
  return cacheDelete(cacheKeys.projectStats(projectId));
}

export async function createProject(user: AuthUser, input: CreateProjectBody) {
  const project = await prisma.$transaction(async (tx) => {
    await assertActiveProjectSlot(tx, user.id);
    const created = await tx.project.create({
      data: { ...input, ownerId: user.id },
      select: projectSelect,
    });
    await writeAuditLog(tx, {
      actorId: user.id,
      action: "PROJECT_CREATED",
      entityType: "PROJECT",
      entityId: created.id,
      metadata: { name: created.name },
    });
    return created;
  }, TX_OPTIONS);

  return toProject(project);
}

export async function listProjects(user: AuthUser, query: ListProjectsQuery) {
  const { page, limit, sortBy, sortOrder, search, status } = query;

  const where: Prisma.ProjectWhereInput = {
    ...projectScope(user),
    ...(status ? { status } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { description: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const orderBy: Prisma.ProjectOrderByWithRelationInput[] = [
    sortBy === "dueDate"
      ? { dueDate: { sort: sortOrder, nulls: "last" } }
      : { [sortBy]: sortOrder },
    { id: "asc" },
  ];

  const [rows, total] = await Promise.all([
    prisma.project.findMany({ where, orderBy, select: projectSelect, ...toSkipTake(page, limit) }),
    prisma.project.count({ where }),
  ]);

  return { projects: rows.map(toProject), meta: buildMeta(page, limit, total) };
}

export async function getProject(user: AuthUser, projectId: string) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, ...projectScope(user) },
    select: projectSelect,
  });
  if (!project) {
    throw new AppError(404, "Project not found");
  }

  const stats = await cached(cacheKeys.projectStats(projectId), CACHE_TTL.projectStats, () =>
    computeProjectStats(projectId),
  );
  return { ...toProject(project), stats };
}

export async function updateProject(user: AuthUser, projectId: string, input: UpdateProjectBody) {
  const project = await prisma.$transaction(async (tx) => {
    const current = await findOwnedProject(tx, user, projectId);
    const reactivating = current.status === "ARCHIVED" && input.status === "ACTIVE";

    if (current.status === "ARCHIVED" && !reactivating) {
      throw new AppError(
        409,
        "Project is archived. Send status ACTIVE to make it active again before other changes.",
      );
    }
    // Making a project active again counts toward the plan limit (BR-7).
    if (reactivating) {
      await assertActiveProjectSlot(tx, user.id);
    }

    const updated = await tx.project.update({
      where: { id: projectId },
      data: input,
      select: projectSelect,
    });
    await writeAuditLog(tx, {
      actorId: user.id,
      action: "PROJECT_UPDATED",
      entityType: "PROJECT",
      entityId: projectId,
      metadata: {
        fields: Object.keys(input),
        ...(input.status && input.status !== current.status
          ? { statusFrom: current.status, statusTo: input.status }
          : {}),
      },
    });
    return updated;
  }, TX_OPTIONS);

  return toProject(project);
}

/** Soft delete: the project and its tasks get `deletedAt` in one transaction (BR-11). */
export async function deleteProject(user: AuthUser, projectId: string) {
  const result = await prisma.$transaction(async (tx) => {
    const project = await findOwnedProject(tx, user, projectId);
    const deletedAt = new Date();

    const { count } = await tx.project.updateMany({
      where: { id: projectId, deletedAt: null },
      data: { deletedAt },
    });
    if (count === 0) {
      throw new AppError(404, "Project not found");
    }
    const tasks = await tx.task.updateMany({
      where: { projectId, deletedAt: null },
      data: { deletedAt },
    });
    await writeAuditLog(tx, {
      actorId: user.id,
      action: "PROJECT_DELETED",
      entityType: "PROJECT",
      entityId: projectId,
      metadata: { name: project.name, deletedTasks: tasks.count },
    });
    return { id: projectId, deletedTasks: tasks.count };
  }, TX_OPTIONS);

  await invalidateProjectStats(projectId);
  return result;
}
