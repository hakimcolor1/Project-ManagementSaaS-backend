import { z } from "zod";
import { paginationFields, searchField, sortFields } from "../../utils/pagination.js";
import {
  dueDateField,
  hasAnyKey,
  notEmpty,
  optionalText,
  uuidField,
} from "../../utils/validators.js";

const projectName = z
  .string({ error: "Project name is required" })
  .trim()
  .min(2, "Project name must be at least 2 characters")
  .max(100, "Project name must be at most 100 characters");

const projectStatus = z.enum(["ACTIVE", "ARCHIVED"], {
  error: "status must be ACTIVE or ARCHIVED",
});

const projectParams = z.strictObject({ id: uuidField("Project id") });

export const projectParamsSchema = z.object({ params: projectParams });

export const createProjectSchema = z.object({
  body: z.strictObject({
    name: projectName,
    description: optionalText("description", 1000),
    dueDate: dueDateField.optional(),
  }),
});

export const listProjectsSchema = z.object({
  query: z.strictObject({
    ...paginationFields,
    ...sortFields(["createdAt", "name", "dueDate"], { sortBy: "createdAt", sortOrder: "desc" }),
    search: searchField,
    status: projectStatus.optional(),
  }),
});

export const updateProjectSchema = z.object({
  params: projectParams,
  body: z
    .strictObject({
      name: projectName.optional(),
      description: optionalText("description", 1000),
      dueDate: dueDateField.nullable().optional(),
      status: projectStatus.optional(),
    })
    .refine(hasAnyKey, notEmpty("name, description, dueDate, status")),
});

export const addMemberSchema = z.object({
  params: projectParams,
  body: z.strictObject({
    email: z
      .string({ error: "Email is required" })
      .trim()
      .toLowerCase()
      .max(255, "Email must be at most 255 characters")
      .pipe(z.email({ error: "Enter a valid email address" })),
  }),
});

export const removeMemberSchema = z.object({
  params: z.strictObject({ id: uuidField("Project id"), userId: uuidField("userId") }),
});

export type CreateProjectBody = z.infer<typeof createProjectSchema>["body"];
export type ListProjectsQuery = z.infer<typeof listProjectsSchema>["query"];
export type UpdateProjectBody = z.infer<typeof updateProjectSchema>["body"];
export type AddMemberBody = z.infer<typeof addMemberSchema>["body"];
