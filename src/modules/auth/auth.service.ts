import { randomUUID } from "node:crypto";
import type { Prisma } from "../../generated/prisma/client.js";
import type { Role } from "../../generated/prisma/enums.js";
import type { GoogleProfile } from "../../lib/google.js";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../../lib/jwt.js";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../utils/AppError.js";
import { sha256 } from "../../utils/hash.js";
import { hashPassword, verifyPassword } from "../../utils/password.js";
import { userSummarySelect } from "../users/users.select.js";
import type { LoginBody, RegisterBody, SignupRole } from "./auth.validation.js";

type Db = Prisma.TransactionClient | typeof prisma;

const INVALID_CREDENTIALS = "Invalid email or password";
const INVALID_REFRESH_TOKEN = "Invalid or expired refresh token. Please log in again.";
const ACCOUNT_BLOCKED = "Your account is blocked. Please contact support.";

/** Creates an access token + a refresh token and stores only the refresh token's hash. */
async function issueTokens(db: Db, user: { id: string; role: Role }) {
  const accessToken = signAccessToken({ userId: user.id, role: user.role });
  const { token: refreshToken, expiresAt } = signRefreshToken(user.id);
  await db.refreshToken.create({
    data: { userId: user.id, tokenHash: sha256(refreshToken), expiresAt },
  });
  return { accessToken, refreshToken };
}

/** Comparing against a dummy hash keeps "unknown email" as slow as "wrong password". */
let dummyHash: Promise<string> | undefined;
function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(randomUUID());
  return dummyHash;
}

export async function register(input: RegisterBody) {
  const existing = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true },
  });
  if (existing) {
    throw new AppError(409, "This email is already registered", [
      { field: "email", message: "This email is already registered" },
    ]);
  }

  const passwordHash = await hashPassword(input.password);
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { name: input.name, email: input.email, role: input.role, passwordHash },
      select: userSummarySelect,
    });
    const tokens = await issueTokens(tx, user);
    return { user, ...tokens };
  });
}

export async function login(input: LoginBody) {
  const found = await prisma.user.findUnique({
    where: { email: input.email },
    select: { ...userSummarySelect, passwordHash: true },
  });

  const passwordOk = await verifyPassword(
    input.password,
    found?.passwordHash ?? (await getDummyHash()),
  );
  // Same answer for "unknown email", "Google-only account" and "wrong password".
  if (!found?.passwordHash || !passwordOk) {
    throw new AppError(401, INVALID_CREDENTIALS);
  }

  const { passwordHash: _passwordHash, ...user } = found;
  if (user.status === "BLOCKED") {
    throw new AppError(403, ACCOUNT_BLOCKED);
  }

  const tokens = await issueTokens(prisma, user);
  return { user, ...tokens };
}

/** Rotation: the old refresh token is revoked and a new pair is returned. */
export async function refresh(refreshToken: string) {
  try {
    verifyRefreshToken(refreshToken);
  } catch {
    throw new AppError(401, INVALID_REFRESH_TOKEN);
  }

  const stored = await prisma.refreshToken.findUnique({
    where: { tokenHash: sha256(refreshToken) },
    select: {
      id: true,
      userId: true,
      revokedAt: true,
      expiresAt: true,
      user: { select: { id: true, role: true, status: true } },
    },
  });
  if (!stored) {
    throw new AppError(401, INVALID_REFRESH_TOKEN);
  }

  if (stored.revokedAt) {
    // An old (already used or revoked) token came back. It may be stolen,
    // so every session of this user is ended.
    await prisma.refreshToken.updateMany({
      where: { userId: stored.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    throw new AppError(401, INVALID_REFRESH_TOKEN);
  }
  if (stored.expiresAt <= new Date()) {
    throw new AppError(401, INVALID_REFRESH_TOKEN);
  }
  if (stored.user.status === "BLOCKED") {
    throw new AppError(403, ACCOUNT_BLOCKED);
  }

  return prisma.$transaction(async (tx) => {
    // Only one request can revoke this token, even if two arrive at the same time.
    const { count } = await tx.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (count === 0) {
      throw new AppError(401, INVALID_REFRESH_TOKEN);
    }
    return issueTokens(tx, stored.user);
  });
}

/** Ends every session of the user (all refresh tokens are revoked). */
export async function logout(userId: string) {
  const { count } = await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return { revokedSessions: count };
}

/** Finds the user by Google ID, links an existing account by email, or creates a new one. */
export async function loginWithGoogle(profile: GoogleProfile, roleForNewAccount: SignupRole) {
  const user = await prisma.$transaction(async (tx) => {
    const byGoogleId = await tx.user.findUnique({
      where: { googleId: profile.googleId },
      select: userSummarySelect,
    });
    if (byGoogleId) {
      return byGoogleId;
    }

    const byEmail = await tx.user.findUnique({
      where: { email: profile.email },
      select: { ...userSummarySelect, googleId: true },
    });
    if (byEmail) {
      if (byEmail.googleId) {
        throw new AppError(409, "This email is already linked to a different Google account");
      }
      return tx.user.update({
        where: { id: byEmail.id },
        data: { googleId: profile.googleId, avatarUrl: byEmail.avatarUrl ?? profile.avatarUrl },
        select: userSummarySelect,
      });
    }

    return tx.user.create({
      data: {
        name: profile.name,
        email: profile.email,
        googleId: profile.googleId,
        avatarUrl: profile.avatarUrl,
        role: roleForNewAccount,
      },
      select: userSummarySelect,
    });
  });

  if (user.status === "BLOCKED") {
    throw new AppError(403, ACCOUNT_BLOCKED);
  }
  const tokens = await issueTokens(prisma, user);
  return { user, ...tokens };
}
