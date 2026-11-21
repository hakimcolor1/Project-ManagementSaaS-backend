import type { Request, Response } from "express";
import { getCurrentUser } from "../../middlewares/auth.js";
import { sendResponse } from "../../utils/sendResponse.js";
import * as commentsService from "./comments.service.js";
import * as tasksService from "./tasks.service.js";
import type {
  AddCommentBody,
  AssignTaskBody,
  ChangeStatusBody,
  CreateTaskBody,
  ListCommentsQuery,
  ListTasksQuery,
  MyAssignedTasksQuery,
  UpdateTaskBody,
} from "./tasks.validation.js";

/** POST /api/v1/projects/:id/tasks */
export async function createTask(req: Request, res: Response) {
  const task = await tasksService.createTask(
    getCurrentUser(req),
    String(req.params.id),
    req.body as CreateTaskBody,
  );
  sendResponse(res, { statusCode: 201, message: "Task created", data: task });
}

/** GET /api/v1/tasks */
export async function listTasks(req: Request, res: Response) {
  const { tasks, meta } = await tasksService.listTasks(
    getCurrentUser(req),
    req.query as unknown as ListTasksQuery,
  );
  sendResponse(res, { message: "Tasks retrieved", data: tasks, meta });
}

/** GET /api/v1/tasks/my-assigned */
export async function listMyAssignedTasks(req: Request, res: Response) {
  const { tasks, meta } = await tasksService.listMyAssignedTasks(
    getCurrentUser(req),
    req.query as unknown as MyAssignedTasksQuery,
  );
  sendResponse(res, { message: "Assigned tasks retrieved", data: tasks, meta });
}

/** GET /api/v1/tasks/:id */
export async function getTask(req: Request, res: Response) {
  const task = await tasksService.getTask(getCurrentUser(req), String(req.params.id));
  sendResponse(res, { message: "Task retrieved", data: task });
}

/** PATCH /api/v1/tasks/:id */
export async function updateTask(req: Request, res: Response) {
  const task = await tasksService.updateTask(
    getCurrentUser(req),
    String(req.params.id),
    req.body as UpdateTaskBody,
  );
  sendResponse(res, { message: "Task updated", data: task });
}

/** DELETE /api/v1/tasks/:id */
export async function deleteTask(req: Request, res: Response) {
  const result = await tasksService.deleteTask(getCurrentUser(req), String(req.params.id));
  sendResponse(res, { message: "Task deleted", data: result });
}

/** PATCH /api/v1/tasks/:id/status */
export async function changeTaskStatus(req: Request, res: Response) {
  const task = await tasksService.changeTaskStatus(
    getCurrentUser(req),
    String(req.params.id),
    (req.body as ChangeStatusBody).status,
  );
  sendResponse(res, { message: `Task moved to ${task.status}`, data: task });
}

/** PATCH /api/v1/tasks/:id/assign */
export async function assignTask(req: Request, res: Response) {
  const { assigneeId } = req.body as AssignTaskBody;
  const task = await tasksService.assignTask(
    getCurrentUser(req),
    String(req.params.id),
    assigneeId,
  );
  sendResponse(res, { message: assigneeId ? "Task assigned" : "Task unassigned", data: task });
}

/** POST /api/v1/tasks/:id/comments */
export async function addComment(req: Request, res: Response) {
  const comment = await commentsService.addComment(
    getCurrentUser(req),
    String(req.params.id),
    (req.body as AddCommentBody).body,
  );
  sendResponse(res, { statusCode: 201, message: "Comment added", data: comment });
}

/** GET /api/v1/tasks/:id/comments */
export async function listComments(req: Request, res: Response) {
  const { comments, meta } = await commentsService.listComments(
    getCurrentUser(req),
    String(req.params.id),
    req.query as unknown as ListCommentsQuery,
  );
  sendResponse(res, { message: "Comments retrieved", data: comments, meta });
}
