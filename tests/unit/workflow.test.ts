import { describe, expect, it } from "vitest";
import { buildMeta, toSkipTake } from "../../src/utils/pagination.js";
import { hasRoomFor } from "../../src/utils/plan.js";
import { allowedNextStatuses, checkStatusMove, isOverdue } from "../../src/utils/taskWorkflow.js";

describe("checkStatusMove", () => {
  it("allows the assignee to work and submit for review", () => {
    expect(checkStatusMove("TODO", "IN_PROGRESS", "ASSIGNEE", true)).toEqual({ ok: true });
    expect(checkStatusMove("IN_PROGRESS", "TODO", "ASSIGNEE", true)).toEqual({ ok: true });
    expect(checkStatusMove("IN_PROGRESS", "IN_REVIEW", "ASSIGNEE", true)).toEqual({ ok: true });
  });

  it("keeps approve, send back and reopen for the owner (403 for the assignee)", () => {
    for (const [from, to] of [
      ["IN_REVIEW", "DONE"],
      ["IN_REVIEW", "IN_PROGRESS"],
      ["DONE", "IN_PROGRESS"],
    ] as const) {
      expect(checkStatusMove(from, to, "OWNER", true)).toEqual({ ok: true });
      expect(checkStatusMove(from, to, "ASSIGNEE", true)).toMatchObject({
        ok: false,
        statusCode: 403,
      });
    }
  });

  it("rejects moves that are not in the table with 409", () => {
    expect(checkStatusMove("DONE", "TODO", "OWNER", true)).toEqual({
      ok: false,
      statusCode: 409,
      message: "Cannot move task from DONE to TODO",
    });
    expect(checkStatusMove("TODO", "DONE", "OWNER", true)).toMatchObject({ statusCode: 409 });
    expect(checkStatusMove("TODO", "TODO", "OWNER", true)).toMatchObject({ statusCode: 409 });
  });

  it("needs an assignee to leave TODO", () => {
    expect(checkStatusMove("TODO", "IN_PROGRESS", "OWNER", false)).toMatchObject({
      ok: false,
      statusCode: 409,
    });
  });

  it("lists the next statuses per actor", () => {
    expect(allowedNextStatuses("IN_REVIEW", "OWNER")).toEqual(["IN_PROGRESS", "DONE"]);
    expect(allowedNextStatuses("IN_REVIEW", "ASSIGNEE")).toEqual([]);
  });
});

describe("isOverdue", () => {
  const now = new Date("2026-11-20T12:00:00Z");
  const yesterday = new Date("2026-11-19T12:00:00Z");

  it("is true for an open task past its due date", () => {
    expect(isOverdue({ dueDate: yesterday, status: "IN_PROGRESS" }, now)).toBe(true);
  });

  it("is false for DONE tasks and tasks without a due date", () => {
    expect(isOverdue({ dueDate: yesterday, status: "DONE" }, now)).toBe(false);
    expect(isOverdue({ dueDate: null, status: "TODO" }, now)).toBe(false);
  });
});

describe("plan limit and pagination helpers", () => {
  it("hasRoomFor treats null as no limit", () => {
    expect(hasRoomFor(2, 1)).toBe(true);
    expect(hasRoomFor(2, 2)).toBe(false);
    expect(hasRoomFor(null, 1000)).toBe(true);
  });

  it("builds skip/take and meta", () => {
    expect(toSkipTake(3, 10)).toEqual({ skip: 20, take: 10 });
    expect(buildMeta(1, 10, 0)).toEqual({ page: 1, limit: 10, total: 0, totalPages: 0 });
    expect(buildMeta(2, 10, 23)).toEqual({ page: 2, limit: 10, total: 23, totalPages: 3 });
  });
});
