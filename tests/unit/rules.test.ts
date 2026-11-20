import { describe, expect, it } from "vitest";
import { parseDuration } from "../../src/utils/duration.js";
import { getEffectivePlan, PLAN_LIMITS } from "../../src/utils/plan.js";

const now = new Date("2026-11-20T12:00:00Z");

describe("parseDuration", () => {
  it("converts durations to milliseconds", () => {
    expect(parseDuration("30s")).toBe(30_000);
    expect(parseDuration("15m")).toBe(900_000);
    expect(parseDuration("12h")).toBe(43_200_000);
    expect(parseDuration("7d")).toBe(604_800_000);
  });

  it("rejects unknown formats", () => {
    expect(() => parseDuration("7 days")).toThrow();
    expect(() => parseDuration("")).toThrow();
  });
});

describe("getEffectivePlan", () => {
  it("is FREE for FREE users", () => {
    expect(getEffectivePlan({ plan: "FREE", planExpiresAt: null }, now)).toBe("FREE");
  });

  it("is PRO while PRO has not expired", () => {
    const later = new Date("2026-12-01T00:00:00Z");
    expect(getEffectivePlan({ plan: "PRO", planExpiresAt: later }, now)).toBe("PRO");
  });

  it("falls back to FREE when PRO has expired", () => {
    const earlier = new Date("2026-11-01T00:00:00Z");
    expect(getEffectivePlan({ plan: "PRO", planExpiresAt: earlier }, now)).toBe("FREE");
  });

  it("FREE has limits, PRO has none", () => {
    expect(PLAN_LIMITS.FREE).toEqual({ maxActiveProjects: 2, maxMembersPerProject: 3 });
    expect(PLAN_LIMITS.PRO).toEqual({ maxActiveProjects: null, maxMembersPerProject: null });
  });
});
