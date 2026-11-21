import type { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import type { AuthUser } from "../../middlewares/auth.js";
import { AppError } from "../../utils/AppError.js";
import { buildMeta, toSkipTake } from "../../utils/pagination.js";
import { assertProjectActive, taskScope } from "../projects/projects.access.js";
import type { ListCommentsQuery } from "./tasks.validation.js";

const commentSelect = {
  id: true,
  body: true,
  createdAt: true,
  updatedAt: true,
  author: { select: { id: true, name: true, role: true, avatarUrl: true } },
} as const satisfies Prisma.CommentSelect;

/** The task must be in the user's workspace: the project owner or a project member (BR-17). */
async function findVisibleTask(user: AuthUser, taskId: string) {
  const task = await prisma.task.findFirst({
    where: { id: taskId, ...taskScope(user) },
    select: { id: true, project: { select: { status: true } } },
  });
  if (!task) {
    throw new AppError(404, "Task not found");
  }
  return task;
}

export async function addComment(user: AuthUser, taskId: string, body: string) {
  const task = await findVisibleTask(user, taskId);
  assertProjectActive(task.project);

  return prisma.comment.create({
    data: { taskId, authorId: user.id, body },
    select: commentSelect,
  });
}

/** Oldest first, so a conversation reads top to bottom. */
export async function listComments(user: AuthUser, taskId: string, query: ListCommentsQuery) {
  await findVisibleTask(user, taskId);
  const { page, limit } = query;

  const [comments, total] = await Promise.all([
    prisma.comment.findMany({
      where: { taskId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: commentSelect,
      ...toSkipTake(page, limit),
    }),
    prisma.comment.count({ where: { taskId } }),
  ]);
  return { comments, meta: buildMeta(page, limit, total) };
}
