import { Router } from "express";
import { auth } from "../../middlewares/auth.js";
import { authorize } from "../../middlewares/authorize.js";
import { validate } from "../../middlewares/validate.js";
import { createTask } from "../tasks/tasks.controller.js";
import { createTaskSchema } from "../tasks/tasks.validation.js";
import {
  addMember,
  createProject,
  deleteProject,
  getProject,
  listMembers,
  listProjects,
  removeMember,
  updateProject,
} from "./projects.controller.js";
import {
  addMemberSchema,
  createProjectSchema,
  listProjectsSchema,
  projectParamsSchema,
  removeMemberSchema,
  updateProjectSchema,
} from "./projects.validation.js";

export const projectRoutes = Router();

// Admins never see project content (tenant privacy), so they get 403 here.
const managerOrMember = [auth, authorize("MANAGER", "MEMBER")];
const managerOnly = [auth, authorize("MANAGER")];

projectRoutes.post("/", ...managerOnly, validate(createProjectSchema), createProject);
projectRoutes.get("/", ...managerOrMember, validate(listProjectsSchema), listProjects);
projectRoutes.get("/:id", ...managerOrMember, validate(projectParamsSchema), getProject);
projectRoutes.patch("/:id", ...managerOnly, validate(updateProjectSchema), updateProject);
projectRoutes.delete("/:id", ...managerOnly, validate(projectParamsSchema), deleteProject);

projectRoutes.post("/:id/members", ...managerOnly, validate(addMemberSchema), addMember);
projectRoutes.get("/:id/members", ...managerOrMember, validate(projectParamsSchema), listMembers);
projectRoutes.delete(
  "/:id/members/:userId",
  ...managerOnly,
  validate(removeMemberSchema),
  removeMember,
);

projectRoutes.post("/:id/tasks", ...managerOnly, validate(createTaskSchema), createTask);
