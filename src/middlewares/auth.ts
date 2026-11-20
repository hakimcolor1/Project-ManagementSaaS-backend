import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import type { Role } from "../generated/prisma/enums.js";
import { verifyAccessToken } from "../lib/jwt.js";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";

export type AuthUser = { id: string; name: string; email: string; role: Role };

declare global {
  namespace Express {
    interface Request {
      /** Set by the `auth` middleware. */
      user?: AuthUser;
    }
  }
}

/**
 * Checks `Authorization: Bearer <accessToken>`, loads the user and rejects blocked accounts.
 * The role comes from the database (not the token), so role changes and blocks apply at once.
 */
export async function auth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) {
    throw new AppError(
      401,
      "Authentication required. Send the header 'Authorization: Bearer <accessToken>'",
    );
  }

  let userId: string;
  try {
    userId = verifyAccessToken(token).userId;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new AppError(
        401,
        "Access token has expired. Get a new one at /api/v1/auth/refresh-token",
      );
    }
    throw new AppError(401, "Invalid access token");
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, role: true, status: true },
  });
  if (!user) {
    throw new AppError(401, "This account no longer exists");
  }
  if (user.status === "BLOCKED") {
    throw new AppError(403, "Your account is blocked. Please contact support.");
  }

  req.user = { id: user.id, name: user.name, email: user.email, role: user.role };
  next();
}

/** The logged-in user. Use only on routes behind the `auth` middleware. */
export function getCurrentUser(req: Request): AuthUser {
  if (!req.user) {
    throw new AppError(401, "Authentication required");
  }
  return req.user;
}
