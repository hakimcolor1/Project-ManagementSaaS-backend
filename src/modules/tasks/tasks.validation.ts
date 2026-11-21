import { z } from "zod";
import { booleanFlag, paginationFields, searchField, sortFields } from "../../utils/pagination.js";
import {
  dueDateField,
  hasAnyKey,
  notEmpty,
  optionalText,
  uuidField,
} from "../../utils/validators.js";

const taskTitle = z
  .string({ error: "Title is required" })
  .trim()
  .min(2, "Title must be at least 2 characters")
  .max(200, "Title must be at most 200 characters");

const taskStatus = z.enum(["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE"], {
  error: "status must be TODO, IN_PROGRESS, IN_REVIEW or DONE",
});

const taskPriority = z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"], {
  error: "priority must be LOW, MEDIUM, HIGH or URGENT",
});

const taskParams = z.strictObject({ id: uuidField("Task id") });

export const taskParamsSchema = z.object({ params: taskParams });

/** POST /projects/:id/tasks */
export const createTaskSchema = z.object({
  params: z.strictObject({ id: uuidField("Project id") }),
  body: z.strictObject({
    title: taskTitle,
    description: optionalText("description", 5000),
    priority: taskPriority.default("MEDIUM"),
    dueDate: dueDateField.optional(),
    assigneeId: uuidField("assigneeId").optional(),
  }),
});

export const listTasksSchema = z.object({
  query: z.strictObject({
    ...paginationFields,
    ...sortFields(["createdAt", "dueDate", "priority", "title"], {
      sortBy: "createdAt",
      sortOrder: "desc",
    }),
    search: searchField,
    projectId: uuidField("projectId").optional(),
    status: taskStatus.optional(),
    priority: taskPriority.optional(),
    assigneeId: uuidField("assigneeId").optional(),
    overdue: booleanFlag,
  }),
});

export const myAssignedTasksSchema = z.object({
  query: z.strictObject({
    ...paginationFields,
    ...sortFields(["createdAt", "dueDate", "priority"], { sortBy: "createdAt", sortOrder: "desc" }),
    status: taskStatus.optional(),
    priority: taskPriority.optional(),
    overdue: booleanFlag,
  }),
});

export const updateTaskSchema = z.object({
  params: taskParams,
  body: z
    .strictObject({
      title: taskTitle.optional(),
      description: optionalText("description", 5000),
      priority: taskPriority.optional(),
      dueDate: dueDateField.nullable().optional(),
    })
    .refine(hasAnyKey, notEmpty("title, description, priority, dueDate")),
});

export const changeStatusSchema = z.object({
  params: taskParams,
  body: z.strictObject({ status: taskStatus }),
});

export const assignTaskSchema = z.object({
  params: taskParams,
  body: z.strictObject({
    // null unassigns the task
    assigneeId: uuidField("assigneeId").nullable(),
  }),
});

export const addCommentSchema = z.object({
  params: taskParams,
  body: z.strictObject({
    body: z
      .string({ error: "Comment body is required" })
      .trim()
      .min(1, "Comment cannot be empty")
      .max(2000, "Comment must be at most 2000 characters"),
  }),
});

export const listCommentsSchema = z.object({
  params: taskParams,
  query: z.strictObject({ ...paginationFields }),
});

export type CreateTaskBody = z.infer<typeof createTaskSchema>["body"];
export type ListTasksQuery = z.infer<typeof listTasksSchema>["query"];
export type MyAssignedTasksQuery = z.infer<typeof myAssignedTasksSchema>["query"];
export type UpdateTaskBody = z.infer<typeof updateTaskSchema>["body"];
export type ChangeStatusBody = z.infer<typeof changeStatusSchema>["body"];
export type AssignTaskBody = z.infer<typeof assignTaskSchema>["body"];
export type AddCommentBody = z.infer<typeof addCommentSchema>["body"];
export type ListCommentsQuery = z.infer<typeof listCommentsSchema>["query"];
