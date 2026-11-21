import type { Request, Response } from "express";
import { getCurrentUser } from "../../middlewares/auth.js";
import { sendResponse } from "../../utils/sendResponse.js";
import * as membersService from "./members.service.js";
import * as projectsService from "./projects.service.js";
import type {
  AddMemberBody,
  CreateProjectBody,
  ListProjectsQuery,
  UpdateProjectBody,
} from "./projects.validation.js";

/** POST /api/v1/projects */
export async function createProject(req: Request, res: Response) {
  const project = await projectsService.createProject(
    getCurrentUser(req),
    req.body as CreateProjectBody,
  );
  sendResponse(res, { statusCode: 201, message: "Project created", data: project });
}

/** GET /api/v1/projects */
export async function listProjects(req: Request, res: Response) {
  const { projects, meta } = await projectsService.listProjects(
    getCurrentUser(req),
    req.query as unknown as ListProjectsQuery,
  );
  sendResponse(res, { message: "Projects retrieved", data: projects, meta });
}

/** GET /api/v1/projects/:id */
export async function getProject(req: Request, res: Response) {
  const project = await projectsService.getProject(getCurrentUser(req), String(req.params.id));
  sendResponse(res, { message: "Project retrieved", data: project });
}

/** PATCH /api/v1/projects/:id */
export async function updateProject(req: Request, res: Response) {
  const project = await projectsService.updateProject(
    getCurrentUser(req),
    String(req.params.id),
    req.body as UpdateProjectBody,
  );
  sendResponse(res, { message: "Project updated", data: project });
}

/** DELETE /api/v1/projects/:id */
export async function deleteProject(req: Request, res: Response) {
  const result = await projectsService.deleteProject(getCurrentUser(req), String(req.params.id));
  sendResponse(res, { message: "Project deleted", data: result });
}

/** POST /api/v1/projects/:id/members */
export async function addMember(req: Request, res: Response) {
  const member = await membersService.addMember(
    getCurrentUser(req),
    String(req.params.id),
    (req.body as AddMemberBody).email,
  );
  sendResponse(res, { statusCode: 201, message: "Member added", data: member });
}

/** GET /api/v1/projects/:id/members */
export async function listMembers(req: Request, res: Response) {
  const members = await membersService.listMembers(getCurrentUser(req), String(req.params.id));
  sendResponse(res, { message: "Members retrieved", data: members });
}

/** DELETE /api/v1/projects/:id/members/:userId */
export async function removeMember(req: Request, res: Response) {
  const result = await membersService.removeMember(
    getCurrentUser(req),
    String(req.params.id),
    String(req.params.userId),
  );
  sendResponse(res, { message: "Member removed", data: result });
}
