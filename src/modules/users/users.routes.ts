import { Router } from "express";
import { auth } from "../../middlewares/auth.js";
import { validate } from "../../middlewares/validate.js";
import { getMe, updateMe } from "./users.controller.js";
import { updateMeSchema } from "./users.validation.js";

export const userRoutes = Router();

userRoutes.get("/me", auth, getMe);
userRoutes.patch("/me", auth, validate(updateMeSchema), updateMe);
