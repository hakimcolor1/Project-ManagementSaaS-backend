import { randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import { isProduction } from "../../config/env.js";
import { getGoogleClient, getGoogleProfile } from "../../lib/google.js";
import { getCurrentUser } from "../../middlewares/auth.js";
import { AppError } from "../../utils/AppError.js";
import { safeEqual } from "../../utils/hash.js";
import { sendResponse } from "../../utils/sendResponse.js";
import * as authService from "./auth.service.js";
import type {
  GoogleCallbackQuery,
  GoogleStartQuery,
  LoginBody,
  RefreshTokenBody,
  RegisterBody,
} from "./auth.validation.js";

const GOOGLE_STATE_COOKIE = "tasknest_oauth_state";
const GOOGLE_COOKIE_PATH = "/api/v1/auth/google";

/** POST /api/v1/auth/register */
export async function register(req: Request, res: Response) {
  const result = await authService.register(req.body as RegisterBody);
  sendResponse(res, { statusCode: 201, message: "Account created successfully", data: result });
}

/** POST /api/v1/auth/login */
export async function login(req: Request, res: Response) {
  const result = await authService.login(req.body as LoginBody);
  sendResponse(res, { message: "Logged in successfully", data: result });
}

/** POST /api/v1/auth/refresh-token */
export async function refreshToken(req: Request, res: Response) {
  const tokens = await authService.refresh((req.body as RefreshTokenBody).refreshToken);
  sendResponse(res, { message: "Tokens refreshed", data: tokens });
}

/** POST /api/v1/auth/logout */
export async function logout(req: Request, res: Response) {
  const result = await authService.logout(getCurrentUser(req).id);
  sendResponse(res, { message: "Logged out from all devices", data: result });
}

/**
 * GET /api/v1/auth/google?role=MANAGER|MEMBER
 * Open in a browser. A random `state` is saved in a short-lived httpOnly cookie
 * and checked on the callback (protects against CSRF).
 */
export function googleStart(req: Request, res: Response) {
  const { role } = req.query as GoogleStartQuery;
  const client = getGoogleClient();
  const state = randomBytes(16).toString("hex");

  res.cookie(GOOGLE_STATE_COOKIE, `${state}.${role}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction,
    maxAge: 10 * 60 * 1000,
    path: GOOGLE_COOKIE_PATH,
  });
  res.redirect(
    client.generateAuthUrl({
      access_type: "online",
      scope: ["openid", "email", "profile"],
      state,
      prompt: "select_account",
    }),
  );
}

/** GET /api/v1/auth/google/callback – Google redirects here; answers with the tokens as JSON. */
export async function googleCallback(req: Request, res: Response) {
  const query = req.query as GoogleCallbackQuery;
  const saved: unknown = req.cookies?.[GOOGLE_STATE_COOKIE];
  res.clearCookie(GOOGLE_STATE_COOKIE, { path: GOOGLE_COOKIE_PATH });

  if (query.error) {
    throw new AppError(400, "Google login was cancelled");
  }

  const [savedState = "", savedRole = ""] = typeof saved === "string" ? saved.split(".") : [];
  if (!query.code || !query.state || !savedState || !safeEqual(savedState, query.state)) {
    throw new AppError(
      400,
      "Invalid or expired Google login session. Start again at /api/v1/auth/google",
    );
  }

  const profile = await getGoogleProfile(query.code);
  const result = await authService.loginWithGoogle(
    profile,
    savedRole === "MANAGER" ? "MANAGER" : "MEMBER",
  );
  sendResponse(res, { message: "Logged in with Google", data: result });
}
