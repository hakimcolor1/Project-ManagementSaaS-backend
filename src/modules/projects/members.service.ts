import type { Prisma } from "../../generated/prisma/client.js";
import { prisma, TX_OPTIONS } from "../../lib/prisma.js";
import type { AuthUser } from "../../middlewares/auth.js";
import { AppError } from "../../utils/AppError.js";
import { writeAuditLog } from "../../utils/audit.js";
import {
  assertMemberSlot,
  assertProjectActive,
  findOwnedProject,
  projectScope,
} from "./projects.access.js";
import { invalidateProjectStats } from "./projects.service.js";

const memberSelect = {
  joinedAt: true,
  user: { select: { id: true, name: true, email: true, avatarUrl: true } },
} as const satisfies Prisma.ProjectMemberSelect;

type MemberRow = Prisma.ProjectMemberGetPayload<{ select: typeof memberSelect }>;

const toMember = ({ user, joinedAt }: MemberRow) => ({ ...user, joinedAt });

export async function listMembers(user: AuthUser, projectId: string) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, ...projectScope(user) },
    select: { id: true },
  });
  if (!project) {
    throw new AppError(404, "Project not found");
  }

  const members = await prisma.projectMember.findMany({
    where: { projectId, removedAt: null },
    orderBy: [{ joinedAt: "asc" }, { id: "asc" }],
    select: memberSelect,
  });
  return members.map(toMember);
}

/**
 * Adds a member by email (BR-9). A removed member is restored instead of duplicated (BR-10).
 * The project row is locked while the member limit is checked (§9.1).
 */
export async function addMember(user: AuthUser, projectId: string, email: string) {
  const member = await prisma.$transaction(async (tx) => {
    const project = await findOwnedProject(tx, user, projectId);
    assertProjectActive(project);

    const target = await tx.user.findUnique({
      where: { email },
      select: { id: true, role: true, status: true },
    });
    if (!target) {
      throw new AppError(400, "No account uses this email address", [
        { field: "email", message: "No account uses this email address" },
      ]);
    }
    if (target.role !== "MEMBER") {
      throw new AppError(400, "Only users with the MEMBER role can join a project", [
        { field: "email", message: `This user is a ${target.role}, not a MEMBER` },
      ]);
    }
    if (target.status !== "ACTIVE") {
      throw new AppError(400, "This user is blocked and cannot join a project", [
        { field: "email", message: "This user is blocked" },
      ]);
    }

    const existing = await tx.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId: target.id } },
      select: { id: true, removedAt: true },
    });
    if (existing && existing.removedAt === null) {
      throw new AppError(409, "This user is already a member of the project");
    }

    await assertMemberSlot(tx, projectId, user.id);

    const saved = existing
      ? await tx.projectMember.update({
          where: { id: existing.id },
          data: { removedAt: null, joinedAt: new Date() },
          select: memberSelect,
        })
      : await tx.projectMember.create({
          data: { projectId, userId: target.id },
          select: memberSelect,
        });

    await writeAuditLog(tx, {
      actorId: user.id,
      action: "MEMBER_ADDED",
      entityType: "PROJECT",
      entityId: projectId,
      metadata: { userId: target.id, email, restored: existing !== null },
    });
    return saved;
  }, TX_OPTIONS);

  await invalidateProjectStats(projectId);
  return toMember(member);
}

/**
 * Removes a member (BR-10): their unfinished tasks in the project become unassigned and go
 * back to TODO in the same transaction. DONE tasks keep the assignee as history.
 */
export async function removeMember(user: AuthUser, projectId: string, memberId: string) {
  const result = await prisma.$transaction(async (tx) => {
    const project = await findOwnedProject(tx, user, projectId);
    assertProjectActive(project);

    const { count } = await tx.projectMember.updateMany({
      where: { projectId, userId: memberId, removedAt: null },
      data: { removedAt: new Date() },
    });
    if (count === 0) {
      throw new AppError(404, "This user is not a member of the project");
    }

    const unassigned = await tx.task.updateMany({
      where: { projectId, assigneeId: memberId, deletedAt: null, status: { not: "DONE" } },
      data: { assigneeId: null, status: "TODO" },
    });
    await writeAuditLog(tx, {
      actorId: user.id,
      action: "MEMBER_REMOVED",
      entityType: "PROJECT",
      entityId: projectId,
      metadata: { userId: memberId, unassignedTasks: unassigned.count },
    });
    return { projectId, userId: memberId, unassignedTasks: unassigned.count };
  }, TX_OPTIONS);

  await invalidateProjectStats(projectId);
  return result;
}
