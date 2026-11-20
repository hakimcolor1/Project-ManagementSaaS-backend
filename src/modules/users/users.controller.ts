import type { Request, Response } from "express";
import { getCurrentUser } from "../../middlewares/auth.js";
import { sendResponse } from "../../utils/sendResponse.js";
import * as usersService from "./users.service.js";
import type { UpdateMeBody } from "./users.validation.js";

/** GET /api/v1/users/me */
export async function getMe(req: Request, res: Response) {
  const profile = await usersService.getProfile(getCurrentUser(req).id);
  sendResponse(res, { message: "Profile retrieved", data: profile });
}

/** PATCH /api/v1/users/me */
export async function updateMe(req: Request, res: Response) {
  const profile = await usersService.updateProfile(
    getCurrentUser(req).id,
    req.body as UpdateMeBody,
  );
  sendResponse(res, { message: "Profile updated", data: profile });
}
