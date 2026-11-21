import type { Prisma } from "../../generated/prisma/client.js";
import { prisma, TX_OPTIONS, type Tx } from "../../lib/prisma.js";
import type { AuthUser } from "../../middlewares/auth.js";
import { AppError } from "../../utils/AppError.js";
import { writeAuditLog } from "../../utils/audit.js";
import { buildMeta, toSkipTake } from "../../utils/pagination.js";
import {
  allowedNextStatuses,
  checkStatusMove,
  isOverdue,
  type TaskActor,
} from "../../utils/taskWorkflow.js";
import {
  assertActiveMember,
  assertProjectActive,
  findOwnedProject,
  taskScope,
} from "../projects/projects.access.js";
import { invalidateProjectStats } from "../projects/projects.service.js";
import type {
  CreateTaskBody,
  ListTasksQuery,
  MyAssignedTasksQuery,
  UpdateTaskBody,
} from "./tasks.validation.js";

const taskSelect = {
  id: true,
  title: true,
  description: true,
  status: true,
  priority: true,
  dueDate: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
  project: { select: { id: true, name: true, status: true } },
  assignee: { select: { id: true, name: true, email: true, avatarUrl: true } },
  createdBy: { select: { id: true, name: true } },
  _count: { select: { comments: true } },
} as const satisfies Prisma.TaskSelect;

type TaskRow = Prisma.TaskGetPayload<{ select: typeof taskSelect }>;

function toTask({ _count, ...task }: TaskRow, now = new Date()) {
  return { ...task, isOverdue: isOverdue(task, now), commentCount: _count.comments };
}

const TASK_CHANGED = "Task was changed by someone else. Reload it and try again.";

type TaskFilters = Partial<
  Pick<ListTasksQuery, "search" | "projectId" | "status" | "priority" | "assigneeId" | "overdue">
>;

function buildFilters(filters: TaskFilters, now: Date): Prisma.TaskWhereInput[] {
  const and: Prisma.TaskWhereInput[] = [];
  if (filters.projectId) and.push({ projectId: filters.projectId });
  if (filters.status) and.push({ status: filters.status });
  if (filters.priority) and.push({ priority: filters.priority });
  if (filters.assigneeId) and.push({ assigneeId: filters.assigneeId });
  if (filters.overdue === true) {
    and.push({ dueDate: { lt: now }, status: { not: "DONE" } });
  }
  if (filters.overdue === false) {
    and.push({ OR: [{ dueDate: null }, { dueDate: { gte: now } }, { status: "DONE" }] });
  }
  if (filters.search) {
    and.push({
      OR: [
        { title: { contains: filters.search, mode: "insensitive" } },
        { description: { contains: filters.search, mode: "insensitive" } },
      ],
    });
  }
  return and;
}

function buildOrderBy(
  sortBy: ListTasksQuery["sortBy"],
  sortOrder: "asc" | "desc",
): Prisma.TaskOrderByWithRelationInput[] {
  // Priority sorts in enum order: LOW < MEDIUM < HIGH < URGENT. Tasks without a due date go last.
  const primary: Prisma.TaskOrderByWithRelationInput =
    sortBy === "dueDate"
      ? { dueDate: { sort: sortOrder, nulls: "last" } }
      : { [sortBy]: sortOrder };
  return [primary, { id: "asc" }];
}

async function findTasks(
  where: Prisma.TaskWhereInput,
  query: ListTasksQuery | MyAssignedTasksQuery,
) {
  const { page, limit, sortBy, sortOrder } = query;
  const [rows, total] = await Promise.all([
    prisma.task.findMany({
      where,
      orderBy: buildOrderBy(sortBy, sortOrder),
      select: taskSelect,
      ...toSkipTake(page, limit),
    }),
    prisma.task.count({ where }),
  ]);
  const now = new Date();
  return { tasks: rows.map((row) => toTask(row, now)), meta: buildMeta(page, limit, total) };
}

/** A task in a project this manager owns, or 404. */
async function findOwnedTask(tx: Tx, user: AuthUser, taskId: string) {
  const task = await tx.task.findFirst({
    where: { id: taskId, deletedAt: null, project: { ownerId: user.id, deletedAt: null } },
    select: {
      id: true,
      title: true,
      status: true,
      assigneeId: true,
      projectId: true,
      project: { select: { status: true } },
    },
  });
  if (!task) {
    throw new AppError(404, "Task not found");
  }
  return task;
}

export async function createTask(user: AuthUser, projectId: string, input: CreateTaskBody) {
  const task = await prisma.$transaction(async (tx) => {
    const project = await findOwnedProject(tx, user, projectId);
    assertProjectActive(project);
    if (input.assigneeId) {
      await assertActiveMember(tx, projectId, input.assigneeId);
    }

    const created = await tx.task.create({
      data: { ...input, projectId, createdById: user.id },
      select: taskSelect,
    });
    await writeAuditLog(tx, {
      actorId: user.id,
      action: "TASK_CREATED",
      entityType: "TASK",
      entityId: created.id,
      metadata: { projectId, title: created.title, assigneeId: input.assigneeId ?? null },
    });
    return created;
  }, TX_OPTIONS);

  await invalidateProjectStats(projectId);
  return toTask(task);
}

/** GET /tasks – every task in the user's workspace. */
export function listTasks(user: AuthUser, query: ListTasksQuery) {
  const where: Prisma.TaskWhereInput = {
    AND: [taskScope(user), ...buildFilters(query, new Date())],
  };
  return findTasks(where, query);
}

/** GET /tasks/my-assigned – the member's own tasks in projects they are still in. */
export function listMyAssignedTasks(user: AuthUser, query: MyAssignedTasksQuery) {
  const where: Prisma.TaskWhereInput = {
    AND: [taskScope(user), { assigneeId: user.id }, ...buildFilters(query, new Date())],
  };
  return findTasks(where, query);
}

export async function getTask(user: AuthUser, taskId: string) {
  const task = await prisma.task.findFirst({
    where: { id: taskId, ...taskScope(user) },
    select: taskSelect,
  });
  if (!task) {
    throw new AppError(404, "Task not found");
  }

  // Which status moves this viewer may make next (empty for other members or archived projects).
  const actor: TaskActor | null =
    user.role === "MANAGER" ? "OWNER" : task.assignee?.id === user.id ? "ASSIGNEE" : null;
  const nextStatuses =
    actor && task.project.status === "ACTIVE" ? allowedNextStatuses(task.status, actor) : [];

  return { ...toTask(task), nextStatuses };
}

export async function updateTask(user: AuthUser, taskId: string, input: UpdateTaskBody) {
  const task = await prisma.$transaction(async (tx) => {
    const current = await findOwnedTask(tx, user, taskId);
    assertProjectActive(current.project);

    const updated = await tx.task.update({
      where: { id: taskId },
      data: input,
      select: taskSelect,
    });
    await writeAuditLog(tx, {
      actorId: user.id,
      action: "TASK_UPDATED",
      entityType: "TASK",
      entityId: taskId,
      metadata: { projectId: current.projectId, fields: Object.keys(input) },
    });
    return updated;
  }, TX_OPTIONS);

  await invalidateProjectStats(task.project.id);
  return toTask(task);
}

export async function deleteTask(user: AuthUser, taskId: string) {
  const result = await prisma.$transaction(async (tx) => {
    const task = await findOwnedTask(tx, user, taskId);
    assertProjectActive(task.project);

    const { count } = await tx.task.updateMany({
      where: { id: taskId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (count === 0) {
      throw new AppError(404, "Task not found");
    }
    await writeAuditLog(tx, {
      actorId: user.id,
      action: "TASK_DELETED",
      entityType: "TASK",
      entityId: taskId,
      metadata: { projectId: task.projectId, title: task.title },
    });
    return { id: taskId, projectId: task.projectId };
  }, TX_OPTIONS);

  await invalidateProjectStats(result.projectId);
  return { id: result.id };
}

/**
 * Moves the task status (§3.2). The update only succeeds while the task still has the status
 * and assignee we checked, so two parallel changes cannot both win (§9.1).
 */
export async function changeTaskStatus(user: AuthUser, taskId: string, to: TaskRow["status"]) {
  const task = await prisma.task.findFirst({
    where: { id: taskId, ...taskScope(user) },
    select: {
      id: true,
      status: true,
      assigneeId: true,
      projectId: true,
      project: { select: { status: true } },
    },
  });
  if (!task) {
    throw new AppError(404, "Task not found");
  }

  let actor: TaskActor;
  if (user.role === "MANAGER") {
    actor = "OWNER";
  } else if (task.assigneeId === user.id) {
    actor = "ASSIGNEE";
  } else {
    throw new AppError(403, "You can only change the status of tasks assigned to you");
  }
  assertProjectActive(task.project);

  const check = checkStatusMove(task.status, to, actor, task.assigneeId !== null);
  if (!check.ok) {
    throw new AppError(check.statusCode, check.message);
  }

  const updated = await prisma.$transaction(async (tx) => {
    const { count } = await tx.task.updateMany({
      where: {
        id: taskId,
        deletedAt: null,
        status: task.status,
        assigneeId: task.assigneeId,
        project: { status: "ACTIVE", deletedAt: null },
      },
      // completedAt is set only while DONE (also enforced by a CHECK constraint).
      data: { status: to, completedAt: to === "DONE" ? new Date() : null },
    });
    if (count === 0) {
      throw new AppError(409, TASK_CHANGED);
    }
    await writeAuditLog(tx, {
      actorId: user.id,
      action: "TASK_STATUS_CHANGED",
      entityType: "TASK",
      entityId: taskId,
      metadata: { projectId: task.projectId, from: task.status, to },
    });
    return tx.task.findUniqueOrThrow({ where: { id: taskId }, select: taskSelect });
  }, TX_OPTIONS);

  await invalidateProjectStats(task.projectId);
  return toTask(updated);
}

/** Assign, reassign or unassign (BR-13). */
export async function assignTask(user: AuthUser, taskId: string, assigneeId: string | null) {
  const { task, projectId } = await prisma.$transaction(async (tx) => {
    const current = await findOwnedTask(tx, user, taskId);
    assertProjectActive(current.project);

    if (current.status === "DONE") {
      throw new AppError(409, "A DONE task cannot be reassigned");
    }
    if (assigneeId === null && current.status !== "TODO") {
      throw new AppError(409, "A task can be unassigned only while it is TODO");
    }

    if (assigneeId !== current.assigneeId) {
      if (assigneeId) {
        await assertActiveMember(tx, current.projectId, assigneeId);
      }
      const { count } = await tx.task.updateMany({
        where: {
          id: taskId,
          deletedAt: null,
          status: current.status,
          assigneeId: current.assigneeId,
        },
        data: { assigneeId },
      });
      if (count === 0) {
        throw new AppError(409, TASK_CHANGED);
      }
      await writeAuditLog(tx, {
        actorId: user.id,
        action: "TASK_ASSIGNED",
        entityType: "TASK",
        entityId: taskId,
        metadata: { projectId: current.projectId, from: current.assigneeId, to: assigneeId },
      });
    }

    const task = await tx.task.findUniqueOrThrow({ where: { id: taskId }, select: taskSelect });
    return { task, projectId: current.projectId };
  }, TX_OPTIONS);

  await invalidateProjectStats(projectId);
  return toTask(task);
}
