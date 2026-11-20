import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { Role } from "../generated/prisma/enums.js";
import { parseDuration } from "../utils/duration.js";

const ISSUER = "tasknest-api";
const ALGORITHM = "HS256";

export const ACCESS_TOKEN_TTL_SECONDS = Math.floor(parseDuration(env.JWT_ACCESS_EXPIRES_IN) / 1000);
const REFRESH_TOKEN_TTL_SECONDS = Math.floor(parseDuration(env.JWT_REFRESH_EXPIRES_IN) / 1000);

const ROLES = new Set<string>(Object.values(Role));

export type AccessTokenPayload = { userId: string; role: Role };

/** Short-lived token sent as `Authorization: Bearer <token>`. */
export function signAccessToken({ userId, role }: AccessTokenPayload): string {
  return jwt.sign({ role }, env.JWT_ACCESS_SECRET, {
    subject: userId,
    issuer: ISSUER,
    algorithm: ALGORITHM,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
  });
}

/** Throws jwt.TokenExpiredError or jwt.JsonWebTokenError when the token is not valid. */
export function verifyAccessToken(token: string): AccessTokenPayload {
  const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, {
    issuer: ISSUER,
    algorithms: [ALGORITHM],
  });
  if (
    typeof decoded === "string" ||
    !decoded.sub ||
    typeof decoded.role !== "string" ||
    !ROLES.has(decoded.role)
  ) {
    throw new jwt.JsonWebTokenError("Invalid token payload");
  }
  return { userId: decoded.sub, role: decoded.role as Role };
}

/** Long-lived token used only to get new tokens. The random `jti` makes every token unique. */
export function signRefreshToken(userId: string): { token: string; expiresAt: Date } {
  const token = jwt.sign({}, env.JWT_REFRESH_SECRET, {
    subject: userId,
    jwtid: randomUUID(),
    issuer: ISSUER,
    algorithm: ALGORITHM,
    expiresIn: REFRESH_TOKEN_TTL_SECONDS,
  });
  return { token, expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000) };
}

/** Throws when the signature or expiry is not valid. */
export function verifyRefreshToken(token: string): { userId: string } {
  const decoded = jwt.verify(token, env.JWT_REFRESH_SECRET, {
    issuer: ISSUER,
    algorithms: [ALGORITHM],
  });
  if (typeof decoded === "string" || !decoded.sub) {
    throw new jwt.JsonWebTokenError("Invalid token payload");
  }
  return { userId: decoded.sub };
}
