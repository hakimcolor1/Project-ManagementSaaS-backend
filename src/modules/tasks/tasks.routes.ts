import { Router } from "express";
import { auth } from "../../middlewares/auth.js";
import { authorize } from "../../middlewares/authorize.js";
import { validate } from "../../middlewares/validate.js";
import {
  addComment,
  assignTask,
  changeTaskStatus,
  deleteTask,
  getTask,
  listComments,
  listMyAssignedTasks,
  listTasks,
  updateTask,
} from "./tasks.controller.js";
import {
  addCommentSchema,
  assignTaskSchema,
  changeStatusSchema,
  listCommentsSchema,
  listTasksSchema,
  myAssignedTasksSchema,
  taskParamsSchema,
  updateTaskSchema,
} from "./tasks.validation.js";

export const taskRoutes = Router();

const managerOrMember = [auth, authorize("MANAGER", "MEMBER")];
const managerOnly = [auth, authorize("MANAGER")];
const memberOnly = [auth, authorize("MEMBER")];

taskRoutes.get("/", ...managerOrMember, validate(listTasksSchema), listTasks);
// Must come before "/:id", otherwise "my-assigned" would be read as a task id.
taskRoutes.get("/my-assigned", ...memberOnly, validate(myAssignedTasksSchema), listMyAssignedTasks);
taskRoutes.get("/:id", ...managerOrMember, validate(taskParamsSchema), getTask);
taskRoutes.patch("/:id", ...managerOnly, validate(updateTaskSchema), updateTask);
taskRoutes.delete("/:id", ...managerOnly, validate(taskParamsSchema), deleteTask);

// Owner: every move; assignee: TODO ↔ IN_PROGRESS → IN_REVIEW (checked in the service).
taskRoutes.patch("/:id/status", ...managerOrMember, validate(changeStatusSchema), changeTaskStatus);
taskRoutes.patch("/:id/assign", ...managerOnly, validate(assignTaskSchema), assignTask);

taskRoutes.post("/:id/comments", ...managerOrMember, validate(addCommentSchema), addComment);
taskRoutes.get("/:id/comments", ...managerOrMember, validate(listCommentsSchema), listComments);
