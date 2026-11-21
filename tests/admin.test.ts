import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma.js";
import { resetDatabase } from "./helpers/db.js";
import { api, bearer, createUser, loginAs, PASSWORD } from "./helpers/factory.js";

beforeAll(resetDatabase);
afterAll(async () => {
  await prisma.$disconnect();
});

const DAY_MS = 24 * 60 * 60 * 1000;

describe("admin access", () => {
  it("needs a token (401) and the ADMIN role (403)", async () => {
    const manager = await loginAs("MANAGER");
    const member = await loginAs("MEMBER");

    expect((await api().get("/api/v1/admin/users")).status).toBe(401);
    for (const token of [manager.accessToken, member.accessToken]) {
      expect((await api().get("/api/v1/admin/users").set(bearer(token))).status).toBe(403);
      expect((await api().get("/api/v1/admin/stats").set(bearer(token))).status).toBe(403);
      expect((await api().get("/api/v1/admin/audit-logs").set(bearer(token))).status).toBe(403);
    }
  });
});

describe("GET /api/v1/admin/users", () => {
  it("searches by name or email, filters by role and paginates", async () => {
    const admin = await loginAs("ADMIN");
    const zara = await createUser("MEMBER", { name: "Zara Searchable" });
    await createUser("MANAGER", { name: "Zara Manager" });

    const res = await api()
      .get("/api/v1/admin/users?search=zara&role=MEMBER&limit=5")
      .set(bearer(admin.accessToken));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({
      id: zara.id,
      role: "MEMBER",
      ownedProjects: 0,
      activeMemberships: 0,
    });
    expect(res.body.data[0]).not.toHaveProperty("passwordHash");
    expect(res.body.meta).toEqual({ page: 1, limit: 5, total: 1, totalPages: 1 });
  });

  it("rejects unknown filter values (400)", async () => {
    const admin = await loginAs("ADMIN");
    const res = await api()
      .get("/api/v1/admin/users?role=OWNER&sortBy=password")
      .set(bearer(admin.accessToken));
    expect(res.status).toBe(400);
    expect(res.body.errors.map((e: { field: string }) => e.field).sort()).toEqual([
      "role",
      "sortBy",
    ]);
  });
});

describe("PATCH /api/v1/admin/users/:id/role", () => {
  it("promotes a member without projects to MANAGER and writes an audit log", async () => {
    const admin = await loginAs("ADMIN");
    const member = await loginAs("MEMBER");

    const res = await api()
      .patch(`/api/v1/admin/users/${member.user.id}/role`)
      .set(bearer(admin.accessToken))
      .send({ role: "MANAGER" });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ changed: true, user: { role: "MANAGER" } });

    // The role is read from the database, so the old token already acts as a MANAGER.
    const create = await api()
      .post("/api/v1/projects")
      .set(bearer(member.accessToken))
      .send({ name: "First project after promotion" });
    expect(create.status).toBe(201);

    const log = await prisma.auditLog.findFirst({
      where: { entityId: member.user.id, action: "USER_ROLE_CHANGED" },
    });
    expect(log).toMatchObject({
      actorId: admin.user.id,
      metadata: { from: "MEMBER", to: "MANAGER" },
    });
  });

  it("does not demote a manager who still owns projects (409)", async () => {
    const admin = await loginAs("ADMIN");
    const manager = await createUser("MANAGER");
    await prisma.project.create({ data: { name: "Still owned", ownerId: manager.id } });

    const res = await api()
      .patch(`/api/v1/admin/users/${manager.id}/role`)
      .set(bearer(admin.accessToken))
      .send({ role: "MEMBER" });

    expect(res.status).toBe(409);
    expect(res.body.message).toContain("owns 1 project");
  });

  it("does not promote a member who is still in a project (409)", async () => {
    const admin = await loginAs("ADMIN");
    const manager = await createUser("MANAGER");
    const member = await createUser("MEMBER");
    const project = await prisma.project.create({ data: { name: "Team", ownerId: manager.id } });
    await prisma.projectMember.create({ data: { projectId: project.id, userId: member.id } });

    const res = await api()
      .patch(`/api/v1/admin/users/${member.id}/role`)
      .set(bearer(admin.accessToken))
      .send({ role: "MANAGER" });

    expect(res.status).toBe(409);
  });

  it("protects admins: not your own role, not another admin, never ADMIN (409/409/400)", async () => {
    const admin = await loginAs("ADMIN");
    const otherAdmin = await createUser("ADMIN");

    const self = await api()
      .patch(`/api/v1/admin/users/${admin.user.id}/role`)
      .set(bearer(admin.accessToken))
      .send({ role: "MEMBER" });
    const other = await api()
      .patch(`/api/v1/admin/users/${otherAdmin.id}/role`)
      .set(bearer(admin.accessToken))
      .send({ role: "MEMBER" });
    const toAdmin = await api()
      .patch(`/api/v1/admin/users/${otherAdmin.id}/role`)
      .set(bearer(admin.accessToken))
      .send({ role: "ADMIN" });

    expect(self.status).toBe(409);
    expect(other.status).toBe(409);
    expect(toAdmin.status).toBe(400);
  });

  it("answers 404 for an unknown user", async () => {
    const admin = await loginAs("ADMIN");
    const res = await api()
      .patch("/api/v1/admin/users/00000000-0000-4000-8000-000000000000/role")
      .set(bearer(admin.accessToken))
      .send({ role: "MANAGER" });
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/v1/admin/users/:id/status", () => {
  it("blocking ends every session at once; unblocking allows login again", async () => {
    const admin = await loginAs("ADMIN");
    const member = await loginAs("MEMBER");

    const blocked = await api()
      .patch(`/api/v1/admin/users/${member.user.id}/status`)
      .set(bearer(admin.accessToken))
      .send({ status: "BLOCKED" });
    expect(blocked.status).toBe(200);
    expect(blocked.body.data).toMatchObject({ changed: true, user: { status: "BLOCKED" } });
    expect(blocked.body.data.revokedSessions).toBeGreaterThanOrEqual(1);

    const oldToken = await api().get("/api/v1/users/me").set(bearer(member.accessToken));
    expect(oldToken.status).toBe(403);
    const refresh = await api()
      .post("/api/v1/auth/refresh-token")
      .send({ refreshToken: member.refreshToken });
    expect(refresh.status).toBe(401);

    const unblocked = await api()
      .patch(`/api/v1/admin/users/${member.user.id}/status`)
      .set(bearer(admin.accessToken))
      .send({ status: "ACTIVE" });
    expect(unblocked.body.data.user.status).toBe("ACTIVE");
    const login = await api()
      .post("/api/v1/auth/login")
      .send({ email: member.user.email, password: PASSWORD });
    expect(login.status).toBe(200);
  });

  it("cannot block yourself or another admin (409)", async () => {
    const admin = await loginAs("ADMIN");
    const otherAdmin = await createUser("ADMIN");
    for (const id of [admin.user.id, otherAdmin.id]) {
      const res = await api()
        .patch(`/api/v1/admin/users/${id}/status`)
        .set(bearer(admin.accessToken))
        .send({ status: "BLOCKED" });
      expect(res.status).toBe(409);
    }
  });
});

describe("GET /api/v1/admin/stats", () => {
  it("counts users, projects, tasks, payments and active PRO managers", async () => {
    await resetDatabase();
    const admin = await loginAs("ADMIN");
    const manager = await createUser("MANAGER", {
      plan: "PRO",
      planExpiresAt: new Date(Date.now() + 5 * DAY_MS),
    });
    await createUser("MEMBER");
    await createUser("MEMBER", { status: "BLOCKED" });

    const active = await prisma.project.create({ data: { name: "Active", ownerId: manager.id } });
    await prisma.project.create({ data: { name: "Old", ownerId: manager.id, status: "ARCHIVED" } });
    const deleted = await prisma.project.create({
      data: { name: "Gone", ownerId: manager.id, deletedAt: new Date() },
    });
    const yesterday = new Date(Date.now() - DAY_MS);
    await prisma.task.createMany({
      data: [
        { projectId: active.id, title: "Late", createdById: manager.id, dueDate: yesterday },
        {
          projectId: active.id,
          title: "Finished",
          createdById: manager.id,
          status: "DONE",
          completedAt: new Date(),
        },
        { projectId: deleted.id, title: "Hidden", createdById: manager.id },
      ],
    });
    await prisma.payment.createMany({
      data: [
        { userId: manager.id, amount: "500.00", tranId: "TN-STATS-1", status: "PAID" },
        { userId: manager.id, amount: "500.00", tranId: "TN-STATS-2" },
      ],
    });

    const res = await api().get("/api/v1/admin/stats").set(bearer(admin.accessToken));

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      users: { total: 4, byRole: { ADMIN: 1, MANAGER: 1, MEMBER: 2 }, blocked: 1 },
      projects: { total: 2, ACTIVE: 1, ARCHIVED: 1 },
      tasks: { total: 2, byStatus: { TODO: 1, IN_PROGRESS: 0, IN_REVIEW: 0, DONE: 1 }, overdue: 1 },
      payments: {
        byStatus: { PENDING: 1, PAID: 1, FAILED: 0, CANCELLED: 0 },
        revenue: "500.00",
        currency: "BDT",
      },
      subscriptions: { activeProManagers: 1 },
    });
  });
});

describe("GET /api/v1/admin/audit-logs", () => {
  it("filters by action and entity, newest first, with pagination", async () => {
    await resetDatabase();
    const admin = await loginAs("ADMIN");
    const member = await createUser("MEMBER");
    for (const status of ["BLOCKED", "ACTIVE"]) {
      await api()
        .patch(`/api/v1/admin/users/${member.id}/status`)
        .set(bearer(admin.accessToken))
        .send({ status });
    }

    const res = await api()
      .get(`/api/v1/admin/audit-logs?action=USER_STATUS_CHANGED&entityId=${member.id}&limit=1`)
      .set(bearer(admin.accessToken));

    expect(res.status).toBe(200);
    expect(res.body.meta).toEqual({ page: 1, limit: 1, total: 2, totalPages: 2 });
    expect(res.body.data[0]).toMatchObject({
      action: "USER_STATUS_CHANGED",
      entityType: "USER",
      entityId: member.id,
      metadata: { from: "BLOCKED", to: "ACTIVE" },
      actor: { id: admin.user.id, role: "ADMIN" },
    });

    const today = new Date().toISOString().slice(0, 10);
    const byDate = await api()
      .get(`/api/v1/admin/audit-logs?entityType=USER&from=${today}&to=${today}`)
      .set(bearer(admin.accessToken));
    expect(byDate.body.meta.total).toBe(2);
  });

  it("rejects invalid filters (400)", async () => {
    const admin = await loginAs("ADMIN");
    const res = await api()
      .get("/api/v1/admin/audit-logs?action=HACKED&from=2026-12-31&to=2026-01-01")
      .set(bearer(admin.accessToken));
    expect(res.status).toBe(400);
    const badDates = await api()
      .get("/api/v1/admin/audit-logs?from=2026-12-31&to=2026-01-01")
      .set(bearer(admin.accessToken));
    expect(badDates.status).toBe(400);
    expect(badDates.body.errors[0].field).toBe("from");
  });
});
