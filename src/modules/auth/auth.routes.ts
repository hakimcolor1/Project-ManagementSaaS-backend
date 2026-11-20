import { Router } from "express";
import { auth } from "../../middlewares/auth.js";
import { authLimiter } from "../../middlewares/rateLimit.js";
import { validate } from "../../middlewares/validate.js";
import {
  googleCallback,
  googleStart,
  login,
  logout,
  refreshToken,
  register,
} from "./auth.controller.js";
import {
  googleCallbackSchema,
  googleStartSchema,
  loginSchema,
  refreshTokenSchema,
  registerSchema,
} from "./auth.validation.js";

export const authRoutes = Router();

authRoutes.post("/register", authLimiter, validate(registerSchema), register);
authRoutes.post("/login", authLimiter, validate(loginSchema), login);
authRoutes.post("/refresh-token", authLimiter, validate(refreshTokenSchema), refreshToken);
authRoutes.post("/logout", auth, logout);
authRoutes.get("/google", validate(googleStartSchema), googleStart);
authRoutes.get("/google/callback", validate(googleCallbackSchema), googleCallback);
