import type { Plan } from "../generated/prisma/enums.js";

type PlanLimits = { maxActiveProjects: number | null; maxMembersPerProject: number | null };

/** null = no limit */
export const PLAN_LIMITS = {
  FREE: { maxActiveProjects: 2, maxMembersPerProject: 3 },
  PRO: { maxActiveProjects: null, maxMembersPerProject: null },
} as const satisfies Record<Plan, PlanLimits>;

export const PRO_PLAN = { price: "500.00", currency: "BDT", durationDays: 30 } as const;

/** Is there room for one more, given a limit (null = no limit) and how many are used? */
export function hasRoomFor(limit: number | null, used: number): boolean {
  return limit === null || used < limit;
}

/** PRO only counts while it has not expired; otherwise the manager is on FREE. */
export function getEffectivePlan(
  user: { plan: Plan; planExpiresAt: Date | null },
  now: Date = new Date(),
): Plan {
  return user.plan === "PRO" && user.planExpiresAt !== null && user.planExpiresAt > now
    ? "PRO"
    : "FREE";
}
