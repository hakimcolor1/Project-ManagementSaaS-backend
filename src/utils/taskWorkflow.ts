import type { TaskStatus } from "../generated/prisma/enums.js";

/** OWNER = the manager who owns the project; ASSIGNEE = the member the task is assigned to. */
export type TaskActor = "OWNER" | "ASSIGNEE";

/** Allowed status moves (requirements §3.2) and who may make each one. */
const MOVES: Record<TaskStatus, Partial<Record<TaskStatus, readonly TaskActor[]>>> = {
  TODO: { IN_PROGRESS: ["OWNER", "ASSIGNEE"] },
  IN_PROGRESS: { TODO: ["OWNER", "ASSIGNEE"], IN_REVIEW: ["OWNER", "ASSIGNEE"] },
  IN_REVIEW: { IN_PROGRESS: ["OWNER"], DONE: ["OWNER"] },
  DONE: { IN_PROGRESS: ["OWNER"] },
};

export type MoveCheck = { ok: true } | { ok: false; statusCode: 403 | 409; message: string };

/**
 * Checks one status move. A move that is not in the table → 409.
 * A move that exists but only the project owner may make → 403 for the assignee.
 */
export function checkStatusMove(
  from: TaskStatus,
  to: TaskStatus,
  actor: TaskActor,
  hasAssignee: boolean,
): MoveCheck {
  const allowedActors = MOVES[from][to];
  if (!allowedActors) {
    return { ok: false, statusCode: 409, message: `Cannot move task from ${from} to ${to}` };
  }
  if (!allowedActors.includes(actor)) {
    return {
      ok: false,
      statusCode: 403,
      message: `Only the project owner can move a task from ${from} to ${to}`,
    };
  }
  if (from === "TODO" && !hasAssignee) {
    return {
      ok: false,
      statusCode: 409,
      message: "Assign the task to a member before moving it out of TODO",
    };
  }
  return { ok: true };
}

/** The moves this actor may make from a status (handy for clients and error messages). */
export function allowedNextStatuses(from: TaskStatus, actor: TaskActor): TaskStatus[] {
  return (Object.entries(MOVES[from]) as [TaskStatus, readonly TaskActor[]][])
    .filter(([, actors]) => actors.includes(actor))
    .map(([status]) => status);
}

/** Overdue = has a due date in the past and is not DONE (BR-16). */
export function isOverdue(task: { dueDate: Date | null; status: TaskStatus }, now = new Date()) {
  return task.dueDate !== null && task.dueDate < now && task.status !== "DONE";
}
