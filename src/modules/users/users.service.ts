import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../utils/AppError.js";
import { getEffectivePlan, PLAN_LIMITS } from "../../utils/plan.js";
import { userSummarySelect } from "./users.select.js";
import type { UpdateMeBody } from "./users.validation.js";

/** Profile + (for managers) the current plan, its limits and how much is used. */
export async function getProfile(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { ...userSummarySelect, plan: true, planExpiresAt: true },
  });
  if (!user) {
    throw new AppError(404, "User not found");
  }

  const { plan, planExpiresAt, ...profile } = user;
  if (profile.role !== "MANAGER") {
    return { ...profile, subscription: null };
  }

  const effectivePlan = getEffectivePlan({ plan, planExpiresAt });
  const activeProjects = await prisma.project.count({
    where: { ownerId: userId, deletedAt: null, status: "ACTIVE" },
  });

  return {
    ...profile,
    subscription: {
      plan: effectivePlan,
      expiresAt: effectivePlan === "PRO" ? planExpiresAt : null,
      limits: PLAN_LIMITS[effectivePlan],
      usage: { activeProjects },
    },
  };
}

export async function updateProfile(userId: string, input: UpdateMeBody) {
  await prisma.user.update({ where: { id: userId }, data: input, select: { id: true } });
  return getProfile(userId);
}
