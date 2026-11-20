import type { RequestHandler } from "express";
import type { Role } from "../generated/prisma/enums.js";
import { AppError } from "../utils/AppError.js";
import { getCurrentUser } from "./auth.js";

/** Allows the request only for the given roles (use after `auth`). Other roles get 403. */
export function authorize(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    const user = getCurrentUser(req);
    if (!roles.includes(user.role)) {
      throw new AppError(403, "You do not have permission to perform this action");
    }
    next();
  };
}
