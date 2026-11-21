import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma.js";
import { resetDatabase } from "./helpers/db.js";
import { api, bearer, loginAs } from "./helpers/factory.js";
import { addMember, createTask, daysFromNow, moveTask, setupTeam } from "./helpers/workspace.js";

beforeAll(resetDatabase);
afterAll(async () => {
  await prisma.$disconnect();
});

describe("task status workflow (§3.1 and §3.2)", () => {
  it("runs the whole team flow: work, review, send back, approve, reopen", async () => {
    const { manager, member, project } = await setupTeam();
    const task = await createTask(manager.accessToken, project.id, {
      assigneeId: member.user.id,
      priority: "HIGH",
    });
    expect(task).toMatchObject({ status: "TODO", assignee: { id: member.user.id } });

    expect((await moveTask(member.accessToken, task.id, "IN_PROGRESS")).status).toBe(200);
    expect((await moveTask(member.accessToken, task.id, "IN_REVIEW")).status).toBe(200);

    // only the owner can approve or send back
    const selfApprove = await moveTask(member.accessToken, task.id, "DONE");
    expect(selfApprove.status).toBe(403);

    expect((await moveTask(manager.accessToken, task.id, "IN_PROGRESS")).status).toBe(200);
    expect((await moveTask(member.accessToken, task.id, "IN_REVIEW")).status).toBe(200);

    const approved = await moveTask(manager.accessToken, task.id, "DONE");
    expect(approved.status).toBe(200);
    expect(approved.body.data.completedAt).not.toBeNull();

    const invalid = await moveTask(manager.accessToken, task.id, "TODO");
    expect(invalid.status).toBe(409);
    expect(invalid.body.message).toBe("Cannot move task from DONE to TODO");

    const reopened = await moveTask(manager.accessToken, task.id, "IN_PROGRESS");
    expect(reopened.status).toBe(200);
    expect(reopened.body.data.completedAt).toBeNull();

    const logs = await prisma.auditLog.count({
      where: { entityId: task.id, action: "TASK_STATUS_CHANGED" },
    });
    expect(logs).toBe(6);
  });

  it("needs an assignee before a task leaves TODO", async () => {
    const { manager, project } = await setupTeam();
    const task = await createTask(manager.accessToken, project.id);
    const res = await moveTask(manager.accessToken, task.id, "IN_PROGRESS");
    expect(res.status).toBe(409);
  });

  it("lets a member change only their own tasks", async () => {
    const { manager, member, project } = await setupTeam();
    const colleague = await loginAs("MEMBER");
    await addMember(manager.accessToken, project.id, colleague.user.email);
    const task = await createTask(manager.accessToken, project.id, { assigneeId: member.user.id });

    const res = await moveTask(colleague.accessToken, task.id, "IN_PROGRESS");
    expect(res.status).toBe(403);
  });

  it("hides tasks from users outside the project", async () => {
    const { manager, project } = await setupTeam();
    const outsider = await loginAs("MEMBER");
    const otherManager = await loginAs("MANAGER");
    const task = await createTask(manager.accessToken, project.id);

    for (const token of [outsider.accessToken, otherManager.accessToken]) {
      expect((await api().get(`/api/v1/tasks/${task.id}`).set(bearer(token))).status).toBe(404);
      expect((await moveTask(token, task.id, "IN_PROGRESS")).status).toBe(404);
    }
  });

  it("lets only one of two parallel status changes win", async () => {
    const { manager, member, project } = await setupTeam();
    const task = await createTask(manager.accessToken, project.id, { assigneeId: member.user.id });

    const results = await Promise.all([
      moveTask(member.accessToken, task.id, "IN_PROGRESS"),
      moveTask(manager.accessToken, task.id, "IN_PROGRESS"),
    ]);
    expect(results.map((res) => res.status).sort()).toEqual([200, 409]);
  });
});

describe("PATCH /api/v1/tasks/:id/assign", () => {
  it("assigns only active project members", async () => {
    const { manager, project } = await setupTeam();
    const stranger = await loginAs("MEMBER");
    const task = await createTask(manager.accessToken, project.id);

    const res = await api()
      .patch(`/api/v1/tasks/${task.id}/assign`)
      .set(bearer(manager.accessToken))
      .send({ assigneeId: stranger.user.id });
    expect(res.status).toBe(400);
    expect(res.body.errors[0].field).toBe("assigneeId");
  });

  it("unassigns only TODO tasks and never reassigns DONE tasks", async () => {
    const { manager, member, project } = await setupTeam();
    const task = await createTask(manager.accessToken, project.id, { assigneeId: member.user.id });
    const assign = (assigneeId: string | null) =>
      api()
        .patch(`/api/v1/tasks/${task.id}/assign`)
        .set(bearer(manager.accessToken))
        .send({ assigneeId });

    await moveTask(member.accessToken, task.id, "IN_PROGRESS");
    expect((await assign(null)).status).toBe(409);

    await moveTask(manager.accessToken, task.id, "IN_REVIEW");
    await moveTask(manager.accessToken, task.id, "DONE");
    const colleague = await loginAs("MEMBER");
    await addMember(manager.accessToken, project.id, colleague.user.email);
    expect((await assign(colleague.user.id)).status).toBe(409);
  });

  it("reassigns and unassigns a TODO task with audit rows", async () => {
    const { manager, member, project } = await setupTeam();
    const task = await createTask(manager.accessToken, project.id);
    const assign = (assigneeId: string | null) =>
      api()
        .patch(`/api/v1/tasks/${task.id}/assign`)
        .set(bearer(manager.accessToken))
        .send({ assigneeId });

    const assigned = await assign(member.user.id);
    expect(assigned.status).toBe(200);
    expect(assigned.body.data.assignee.id).toBe(member.user.id);

    const unassigned = await assign(null);
    expect(unassigned.status).toBe(200);
    expect(unassigned.body.data.assignee).toBeNull();

    expect(
      await prisma.auditLog.count({ where: { entityId: task.id, action: "TASK_ASSIGNED" } }),
    ).toBe(2);
  });
});

describe("task lists", () => {
  it("filters, searches, sorts and paginates GET /tasks", async () => {
    const { manager, member, project } = await setupTeam();
    await createTask(manager.accessToken, project.id, { title: "Low thing", priority: "LOW" });
    await createTask(manager.accessToken, project.id, {
      title: "Urgent bug",
      priority: "URGENT",
      assigneeId: member.user.id,
    });
    const late = await createTask(manager.accessToken, project.id, {
      title: "Late report",
      description: "quarterly numbers",
    });
    await prisma.task.update({ where: { id: late.id }, data: { dueDate: daysFromNow(-2) } });

    const byPriority = await api()
      .get(`/api/v1/tasks?projectId=${project.id}&sortBy=priority&sortOrder=desc`)
      .set(bearer(manager.accessToken));
    expect(byPriority.status).toBe(200);
    expect(byPriority.body.data[0].title).toBe("Urgent bug");
    expect(byPriority.body.meta.total).toBe(3);

    const overdue = await api().get("/api/v1/tasks?overdue=true").set(bearer(member.accessToken));
    expect(overdue.body.data.map((t: { id: string }) => t.id)).toEqual([late.id]);
    expect(overdue.body.data[0].isOverdue).toBe(true);

    const search = await api()
      .get("/api/v1/tasks?search=QUARTERLY")
      .set(bearer(manager.accessToken));
    expect(search.body.data).toHaveLength(1);

    const urgent = await api()
      .get(`/api/v1/tasks?priority=URGENT&assigneeId=${member.user.id}&limit=1&page=1`)
      .set(bearer(manager.accessToken));
    expect(urgent.body.meta).toEqual({ page: 1, limit: 1, total: 1, totalPages: 1 });
  });

  it("returns only the member's own tasks from /tasks/my-assigned", async () => {
    const { manager, member, project } = await setupTeam();
    const mine = await createTask(manager.accessToken, project.id, { assigneeId: member.user.id });
    await createTask(manager.accessToken, project.id);

    const res = await api().get("/api/v1/tasks/my-assigned").set(bearer(member.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data.map((t: { id: string }) => t.id)).toEqual([mine.id]);

    const managerCall = await api()
      .get("/api/v1/tasks/my-assigned")
      .set(bearer(manager.accessToken));
    expect(managerCall.status).toBe(403);
  });

  it("rejects bad filter values", async () => {
    const manager = await loginAs("MANAGER");
    const res = await api()
      .get("/api/v1/tasks?overdue=yes&limit=500")
      .set(bearer(manager.accessToken));
    expect(res.status).toBe(400);
    expect(res.body.errors.map((e: { field: string }) => e.field).sort()).toEqual([
      "limit",
      "overdue",
    ]);
  });
});

describe("task details, edit and delete", () => {
  it("shows the next allowed statuses for the viewer", async () => {
    const { manager, member, project } = await setupTeam();
    const task = await createTask(manager.accessToken, project.id, { assigneeId: member.user.id });
    await moveTask(member.accessToken, task.id, "IN_PROGRESS");

    const asMember = await api().get(`/api/v1/tasks/${task.id}`).set(bearer(member.accessToken));
    expect(asMember.body.data.nextStatuses).toEqual(["TODO", "IN_REVIEW"]);
    expect(asMember.body.data).toMatchObject({ commentCount: 0, project: { id: project.id } });
  });

  it("lets only the owner edit, and rejects a past due date", async () => {
    const { manager, member, project } = await setupTeam();
    const task = await createTask(manager.accessToken, project.id);

    const byMember = await api()
      .patch(`/api/v1/tasks/${task.id}`)
      .set(bearer(member.accessToken))
      .send({ title: "Mine now" });
    expect(byMember.status).toBe(403);

    const past = await api()
      .patch(`/api/v1/tasks/${task.id}`)
      .set(bearer(manager.accessToken))
      .send({ dueDate: "2001-01-01T00:00:00Z" });
    expect(past.status).toBe(400);

    const ok = await api()
      .patch(`/api/v1/tasks/${task.id}`)
      .set(bearer(manager.accessToken))
      .send({ title: "Better title", priority: "URGENT", dueDate: null });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({
      title: "Better title",
      priority: "URGENT",
      dueDate: null,
    });
  });

  it("soft deletes a task", async () => {
    const { manager, project } = await setupTeam();
    const task = await createTask(manager.accessToken, project.id);

    const res = await api().delete(`/api/v1/tasks/${task.id}`).set(bearer(manager.accessToken));
    expect(res.status).toBe(200);
    expect(
      (await api().get(`/api/v1/tasks/${task.id}`).set(bearer(manager.accessToken))).status,
    ).toBe(404);
    const stored = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(stored.deletedAt).not.toBeNull();
  });
});

describe("comments", () => {
  it("lets the owner and members comment, oldest first with pagination", async () => {
    const { manager, member, project } = await setupTeam();
    const task = await createTask(manager.accessToken, project.id);
    const comment = (token: string, body: string) =>
      api().post(`/api/v1/tasks/${task.id}/comments`).set(bearer(token)).send({ body });

    expect((await comment(manager.accessToken, "First")).status).toBe(201);
    const second = await comment(member.accessToken, "  Second  ");
    expect(second.status).toBe(201);
    expect(second.body.data).toMatchObject({ body: "Second", author: { id: member.user.id } });

    const page = await api()
      .get(`/api/v1/tasks/${task.id}/comments?limit=1&page=2`)
      .set(bearer(manager.accessToken));
    expect(page.body.data.map((c: { body: string }) => c.body)).toEqual(["Second"]);
    expect(page.body.meta).toEqual({ page: 2, limit: 1, total: 2, totalPages: 2 });
  });

  it("rejects empty comments and outsiders", async () => {
    const { manager, project } = await setupTeam();
    const outsider = await loginAs("MEMBER");
    const task = await createTask(manager.accessToken, project.id);

    const empty = await api()
      .post(`/api/v1/tasks/${task.id}/comments`)
      .set(bearer(manager.accessToken))
      .send({ body: "   " });
    expect(empty.status).toBe(400);

    const foreign = await api()
      .post(`/api/v1/tasks/${task.id}/comments`)
      .set(bearer(outsider.accessToken))
      .send({ body: "Hello" });
    expect(foreign.status).toBe(404);
  });
});
