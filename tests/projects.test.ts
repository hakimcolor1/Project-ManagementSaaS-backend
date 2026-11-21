import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma.js";
import { resetDatabase } from "./helpers/db.js";
import { api, bearer, createUser, loginAs } from "./helpers/factory.js";
import {
  addMember,
  createProject,
  createTask,
  daysFromNow,
  moveTask,
  setupTeam,
} from "./helpers/workspace.js";

beforeAll(resetDatabase);
afterAll(async () => {
  await prisma.$disconnect();
});

describe("project access", () => {
  it("lets only managers create projects", async () => {
    const member = await loginAs("MEMBER");
    const res = await api()
      .post("/api/v1/projects")
      .set(bearer(member.accessToken))
      .send({ name: "Not allowed" });
    expect(res.status).toBe(403);
  });

  it("keeps admins out of project content", async () => {
    const admin = await loginAs("ADMIN");
    const res = await api().get("/api/v1/projects").set(bearer(admin.accessToken));
    expect(res.status).toBe(403);
  });

  it("answers 404 for another manager's project", async () => {
    const owner = await loginAs("MANAGER");
    const other = await loginAs("MANAGER");
    const project = await createProject(owner.accessToken);

    const get = await api().get(`/api/v1/projects/${project.id}`).set(bearer(other.accessToken));
    expect(get.status).toBe(404);
    const patch = await api()
      .patch(`/api/v1/projects/${project.id}`)
      .set(bearer(other.accessToken))
      .send({ name: "Hijacked" });
    expect(patch.status).toBe(404);
  });

  it("rejects a bad project id with 400", async () => {
    const manager = await loginAs("MANAGER");
    const res = await api().get("/api/v1/projects/not-a-uuid").set(bearer(manager.accessToken));
    expect(res.status).toBe(400);
    expect(res.body.errors[0].field).toBe("id");
  });
});

describe("POST /api/v1/projects", () => {
  it("creates a project and writes an audit log row", async () => {
    const manager = await loginAs("MANAGER");
    const res = await api()
      .post("/api/v1/projects")
      .set(bearer(manager.accessToken))
      .send({ name: "  Mobile App  ", description: "iOS and Android", dueDate: "2099-01-31" });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      name: "Mobile App",
      status: "ACTIVE",
      dueDate: "2099-01-31T23:59:59.999Z",
      memberCount: 0,
      taskCount: 0,
      owner: { id: manager.user.id },
    });
    const log = await prisma.auditLog.findFirst({
      where: { entityId: res.body.data.id, action: "PROJECT_CREATED" },
    });
    expect(log?.actorId).toBe(manager.user.id);
  });

  it("rejects a due date in the past and unknown fields", async () => {
    const manager = await loginAs("MANAGER");
    const past = await api()
      .post("/api/v1/projects")
      .set(bearer(manager.accessToken))
      .send({ name: "Late", dueDate: "2020-01-01" });
    expect(past.status).toBe(400);
    expect(past.body.errors[0]).toEqual({
      field: "dueDate",
      message: "dueDate cannot be in the past",
    });

    const unknown = await api()
      .post("/api/v1/projects")
      .set(bearer(manager.accessToken))
      .send({ name: "Sneaky", ownerId: manager.user.id });
    expect(unknown.status).toBe(400);
  });
});

describe("FREE plan limits", () => {
  it("allows 2 active projects, then answers 402", async () => {
    const manager = await loginAs("MANAGER");
    await createProject(manager.accessToken);
    await createProject(manager.accessToken);

    const third = await api()
      .post("/api/v1/projects")
      .set(bearer(manager.accessToken))
      .send({ name: "Third" });
    expect(third.status).toBe(402);
    expect(third.body.message).toContain("Upgrade to PRO");
  });

  it("does not count archived projects, but checks the limit when one is activated again", async () => {
    const manager = await loginAs("MANAGER");
    const first = await createProject(manager.accessToken);
    await createProject(manager.accessToken);

    const archive = await api()
      .patch(`/api/v1/projects/${first.id}`)
      .set(bearer(manager.accessToken))
      .send({ status: "ARCHIVED" });
    expect(archive.status).toBe(200);
    await createProject(manager.accessToken); // fits again

    const reactivate = await api()
      .patch(`/api/v1/projects/${first.id}`)
      .set(bearer(manager.accessToken))
      .send({ status: "ACTIVE" });
    expect(reactivate.status).toBe(402);
  });

  it("lets only one of two parallel requests take the last slot", async () => {
    const manager = await loginAs("MANAGER");
    await createProject(manager.accessToken);

    const send = (name: string) =>
      api().post("/api/v1/projects").set(bearer(manager.accessToken)).send({ name });
    const results = await Promise.all([send("Parallel A"), send("Parallel B")]);

    expect(results.map((res) => res.status).sort()).toEqual([201, 402]);
    const active = await prisma.project.count({
      where: { ownerId: manager.user.id, status: "ACTIVE", deletedAt: null },
    });
    expect(active).toBe(2);
  });

  it("has no project limit on an active PRO plan", async () => {
    const manager = await loginAs("MANAGER", { plan: "PRO", planExpiresAt: daysFromNow(10) });
    for (let i = 0; i < 3; i += 1) {
      await createProject(manager.accessToken);
    }
  });

  it("allows 3 members per project on FREE, then answers 402", async () => {
    const manager = await loginAs("MANAGER");
    const project = await createProject(manager.accessToken);
    for (let i = 0; i < 3; i += 1) {
      const member = await createUser("MEMBER");
      await addMember(manager.accessToken, project.id, member.email);
    }
    const fourth = await createUser("MEMBER");
    const res = await api()
      .post(`/api/v1/projects/${project.id}/members`)
      .set(bearer(manager.accessToken))
      .send({ email: fourth.email });
    expect(res.status).toBe(402);
  });
});

describe("GET /api/v1/projects", () => {
  it("lists own projects with search, filter, sort and pagination", async () => {
    const manager = await loginAs("MANAGER", { plan: "PRO", planExpiresAt: daysFromNow(30) });
    const other = await loginAs("MANAGER");
    await createProject(other.accessToken, { name: "Alpha of someone else" });
    await createProject(manager.accessToken, { name: "Alpha site" });
    await createProject(manager.accessToken, { name: "Beta site", description: "alpha testers" });
    const gamma = await createProject(manager.accessToken, { name: "Gamma" });
    await api()
      .patch(`/api/v1/projects/${gamma.id}`)
      .set(bearer(manager.accessToken))
      .send({ status: "ARCHIVED" });

    const all = await api()
      .get("/api/v1/projects?sortBy=name&sortOrder=asc&limit=2")
      .set(bearer(manager.accessToken));
    expect(all.status).toBe(200);
    expect(all.body.data.map((p: { name: string }) => p.name)).toEqual(["Alpha site", "Beta site"]);
    expect(all.body.meta).toEqual({ page: 1, limit: 2, total: 3, totalPages: 2 });

    const search = await api()
      .get("/api/v1/projects?search=ALPHA")
      .set(bearer(manager.accessToken));
    expect(search.body.data).toHaveLength(2); // name or description, never other workspaces

    const archived = await api()
      .get("/api/v1/projects?status=ARCHIVED")
      .set(bearer(manager.accessToken));
    expect(archived.body.data.map((p: { id: string }) => p.id)).toEqual([gamma.id]);
  });

  it("shows members only the projects they joined", async () => {
    const { manager, member, project } = await setupTeam();
    await createProject(manager.accessToken, { name: "Not joined" });

    const res = await api().get("/api/v1/projects").set(bearer(member.accessToken));
    expect(res.body.data.map((p: { id: string }) => p.id)).toEqual([project.id]);
  });

  it("rejects an unknown sort field", async () => {
    const manager = await loginAs("MANAGER");
    const res = await api()
      .get("/api/v1/projects?sortBy=password")
      .set(bearer(manager.accessToken));
    expect(res.status).toBe(400);
    expect(res.body.errors[0].field).toBe("sortBy");
  });
});

describe("GET /api/v1/projects/:id stats", () => {
  it("counts tasks by status, overdue tasks, progress and members", async () => {
    const { manager, member, project } = await setupTeam();
    const done = await createTask(manager.accessToken, project.id, { assigneeId: member.user.id });
    for (const status of ["IN_PROGRESS", "IN_REVIEW", "DONE"]) {
      expect((await moveTask(manager.accessToken, done.id, status)).status).toBe(200);
    }
    await createTask(manager.accessToken, project.id);
    const late = await createTask(manager.accessToken, project.id);
    await prisma.task.update({ where: { id: late.id }, data: { dueDate: daysFromNow(-1) } });

    const res = await api().get(`/api/v1/projects/${project.id}`).set(bearer(member.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data.stats).toEqual({
      totalTasks: 3,
      tasksByStatus: { TODO: 2, IN_PROGRESS: 0, IN_REVIEW: 0, DONE: 1 },
      overdueTasks: 1,
      progressPercent: 33,
      memberCount: 1,
    });
  });
});

describe("project members", () => {
  it("rejects managers, unknown, blocked and duplicate members", async () => {
    const { manager, member, project } = await setupTeam();
    const otherManager = await createUser("MANAGER");
    const blocked = await createUser("MEMBER", { status: "BLOCKED" });
    const add = (email: string) =>
      api()
        .post(`/api/v1/projects/${project.id}/members`)
        .set(bearer(manager.accessToken))
        .send({ email });

    expect((await add(otherManager.email)).status).toBe(400);
    expect((await add("nobody@example.com")).status).toBe(400);
    expect((await add(blocked.email)).status).toBe(400);
    expect((await add(member.user.email.toUpperCase())).status).toBe(409);
  });

  it("lists members for the owner and for members", async () => {
    const { manager, member, project } = await setupTeam();
    for (const token of [manager.accessToken, member.accessToken]) {
      const res = await api().get(`/api/v1/projects/${project.id}/members`).set(bearer(token));
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([
        expect.objectContaining({ id: member.user.id, email: member.user.email }),
      ]);
    }
  });

  it("does not let members add members", async () => {
    const { member, project } = await setupTeam();
    const res = await api()
      .post(`/api/v1/projects/${project.id}/members`)
      .set(bearer(member.accessToken))
      .send({ email: "x@example.com" });
    expect(res.status).toBe(403);
  });

  it("unassigns open tasks on removal, keeps DONE history, and can restore the member", async () => {
    const { manager, member, project } = await setupTeam();
    const open = await createTask(manager.accessToken, project.id, { assigneeId: member.user.id });
    await moveTask(member.accessToken, open.id, "IN_PROGRESS");
    const done = await createTask(manager.accessToken, project.id, { assigneeId: member.user.id });
    for (const status of ["IN_PROGRESS", "IN_REVIEW", "DONE"]) {
      await moveTask(manager.accessToken, done.id, status);
    }

    const removed = await api()
      .delete(`/api/v1/projects/${project.id}/members/${member.user.id}`)
      .set(bearer(manager.accessToken));
    expect(removed.status).toBe(200);
    expect(removed.body.data.unassignedTasks).toBe(1);

    const openTask = await prisma.task.findUniqueOrThrow({ where: { id: open.id } });
    expect(openTask).toMatchObject({ assigneeId: null, status: "TODO" });
    const doneTask = await prisma.task.findUniqueOrThrow({ where: { id: done.id } });
    expect(doneTask).toMatchObject({ assigneeId: member.user.id, status: "DONE" });

    const hidden = await api()
      .get(`/api/v1/projects/${project.id}`)
      .set(bearer(member.accessToken));
    expect(hidden.status).toBe(404);

    await addMember(manager.accessToken, project.id, member.user.email);
    const visible = await api()
      .get(`/api/v1/projects/${project.id}`)
      .set(bearer(member.accessToken));
    expect(visible.status).toBe(200);
    expect(await prisma.projectMember.count({ where: { projectId: project.id } })).toBe(1);
  });
});

describe("archived and deleted projects", () => {
  it("makes an archived project read-only", async () => {
    const { manager, project } = await setupTeam();
    await api()
      .patch(`/api/v1/projects/${project.id}`)
      .set(bearer(manager.accessToken))
      .send({ status: "ARCHIVED" });

    const task = await api()
      .post(`/api/v1/projects/${project.id}/tasks`)
      .set(bearer(manager.accessToken))
      .send({ title: "Too late" });
    expect(task.status).toBe(409);
    expect(task.body.message).toContain("archived");

    const rename = await api()
      .patch(`/api/v1/projects/${project.id}`)
      .set(bearer(manager.accessToken))
      .send({ name: "Renamed" });
    expect(rename.status).toBe(409);
  });

  it("soft deletes the project and its tasks", async () => {
    const { manager, member, project } = await setupTeam();
    const task = await createTask(manager.accessToken, project.id);

    const res = await api()
      .delete(`/api/v1/projects/${project.id}`)
      .set(bearer(manager.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ id: project.id, deletedTasks: 1 });

    expect(
      (await api().get(`/api/v1/projects/${project.id}`).set(bearer(manager.accessToken))).status,
    ).toBe(404);
    expect(
      (await api().get(`/api/v1/tasks/${task.id}`).set(bearer(member.accessToken))).status,
    ).toBe(404);

    const stored = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(stored.deletedAt).not.toBeNull();
    const log = await prisma.auditLog.findFirst({
      where: { entityId: project.id, action: "PROJECT_DELETED" },
    });
    expect(log?.metadata).toMatchObject({ deletedTasks: 1 });
  });
});
