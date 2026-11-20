import type { Prisma } from "../../generated/prisma/client.js";

/** Public user fields. Never includes passwordHash or googleId. */
export const userSummarySelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  status: true,
  avatarUrl: true,
  createdAt: true,
} as const satisfies Prisma.UserSelect;
