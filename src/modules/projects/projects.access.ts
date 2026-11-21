import type { Prisma } from "../../generated/prisma/client.js";
import type { ProjectStatus } from "../../generated/prisma/enums.js";
import { lockRow, type prisma, type Tx } from "../../lib/prisma.js";
import type { AuthUser } from "../../middlewares/auth.js";
import { AppError } from "../../utils/AppError.js";
import { getEffectivePlan, hasRoomFor, PLAN_LIMITS } from "../../utils/plan.js";

type Db = Tx | typeof prisma;

/**
 * Workspace isolation (BR-6): a manager sees only projects they own, a member only projects
 * they are an active member of. Deleted projects are never visible.
 */
export function projectScope(user: AuthUser): Prisma.ProjectWhereInput {
  if (user.role === "MANAGER") {
    return { deletedAt: null, ownerId: user.id };
  }
  return { deletedAt: null, members: { some: { userId: user.id, removedAt: null } } };
}

/** Tasks are visible when they are not deleted and their project is in the user's workspace. */
export function taskScope(user: AuthUser): Prisma.TaskWhereInput {
  return { deletedAt: null, project: projectScope(user) };
}

/** A project owned by this manager, or 404 (the API never reveals other workspaces). */
export async function findOwnedProject(db: Db, user: AuthUser, projectId: string) {
  const project = await db.project.findFirst({
    where: { id: projectId, ownerId: user.id, deletedAt: null },
    select: { id: true, name: true, status: true, ownerId: true },
  });
  if (!project) {
    throw new AppError(404, "Project not found");
  }
  return project;
}

/** An archived project is read-only (BR-7). */
export function assertProjectActive(project: { status: ProjectStatus }): void {
  if (project.status === "ARCHIVED") {
    throw new AppError(409, "Project is archived. Set its status to ACTIVE to make changes.");
  }
}

/** The user must be an active member of the project (BR-13). */
export async function assertActiveMember(db: Db, projectId: string, userId: string) {
  const membership = await db.projectMember.findFirst({
    where: { projectId, userId, removedAt: null, user: { status: "ACTIVE" } },
    select: { id: true },
  });
  if (!membership) {
    throw new AppError(400, "The assignee must be an active member of this project", [
      { field: "assigneeId", message: "Not an active member of this project" },
    ]);
  }
}

async function getOwnerPlanLimits(tx: Tx, ownerId: string) {
  const owner = await tx.user.findUniqueOrThrow({
    where: { id: ownerId },
    select: { plan: true, planExpiresAt: true },
  });
  return PLAN_LIMITS[getEffectivePlan(owner)];
}

/**
 * Plan limit for active projects (BR-8). Locks the owner row first, so two parallel
 * "create project" requests cannot both pass the count (requirements §9.1).
 */
export async function assertActiveProjectSlot(tx: Tx, ownerId: string): Promise<void> {
  await lockRow(tx, "users", ownerId);
  const { maxActiveProjects } = await getOwnerPlanLimits(tx, ownerId);
  const activeProjects = await tx.project.count({
    where: { ownerId, deletedAt: null, status: "ACTIVE" },
  });
  if (!hasRoomFor(maxActiveProjects, activeProjects)) {
    throw new AppError(
      402,
      `Plan limit reached: the FREE plan allows ${maxActiveProjects} active projects. Upgrade to PRO.`,
    );
  }
}

/** Plan limit for members per project (BR-8). Locks the project row first. */
export async function assertMemberSlot(tx: Tx, projectId: string, ownerId: string) {
  await lockRow(tx, "projects", projectId);
  const { maxMembersPerProject } = await getOwnerPlanLimits(tx, ownerId);
  const members = await tx.projectMember.count({ where: { projectId, removedAt: null } });
  if (!hasRoomFor(maxMembersPerProject, members)) {
    throw new AppError(
      402,
      `Plan limit reached: the FREE plan allows ${maxMembersPerProject} members per project. Upgrade to PRO.`,
    );
  }
}
