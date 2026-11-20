import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma.js";
import { resetDatabase } from "./helpers/db.js";
import { api, bearer, loginAs } from "./helpers/factory.js";

beforeAll(resetDatabase);
afterAll(async () => {
  await prisma.$disconnect();
});

const DAY_MS = 24 * 60 * 60 * 1000;

describe("GET /api/v1/users/me", () => {
  it("shows a manager's FREE plan, limits and usage", async () => {
    const { user, accessToken } = await loginAs("MANAGER");
    await prisma.project.create({ data: { name: "Counted project", ownerId: user.id } });

    const res = await api().get("/api/v1/users/me").set(bearer(accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: user.id, email: user.email, role: "MANAGER" });
    expect(res.body.data).not.toHaveProperty("passwordHash");
    expect(res.body.data.subscription).toEqual({
      plan: "FREE",
      expiresAt: null,
      limits: { maxActiveProjects: 2, maxMembersPerProject: 3 },
      usage: { activeProjects: 1 },
    });
  });

  it("shows PRO while it is still active", async () => {
    const expiresAt = new Date(Date.now() + 10 * DAY_MS);
    const { accessToken } = await loginAs("MANAGER", { plan: "PRO", planExpiresAt: expiresAt });

    const res = await api().get("/api/v1/users/me").set(bearer(accessToken));
    expect(res.body.data.subscription).toMatchObject({
      plan: "PRO",
      expiresAt: expiresAt.toISOString(),
      limits: { maxActiveProjects: null, maxMembersPerProject: null },
    });
  });

  it("treats an expired PRO plan as FREE", async () => {
    const { accessToken } = await loginAs("MANAGER", {
      plan: "PRO",
      planExpiresAt: new Date(Date.now() - DAY_MS),
    });
    const res = await api().get("/api/v1/users/me").set(bearer(accessToken));
    expect(res.body.data.subscription.plan).toBe("FREE");
  });

  it("has no subscription for members", async () => {
    const { accessToken } = await loginAs("MEMBER");
    const res = await api().get("/api/v1/users/me").set(bearer(accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data.subscription).toBeNull();
  });
});

describe("PATCH /api/v1/users/me", () => {
  it("updates the name and avatar", async () => {
    const { accessToken } = await loginAs("MEMBER");
    const res = await api()
      .patch("/api/v1/users/me")
      .set(bearer(accessToken))
      .send({ name: "  New Name  ", avatarUrl: "https://example.com/me.png" });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      name: "New Name",
      avatarUrl: "https://example.com/me.png",
    });
  });

  it("does not let users change their own role", async () => {
    const { user, accessToken } = await loginAs("MEMBER");
    const res = await api()
      .patch("/api/v1/users/me")
      .set(bearer(accessToken))
      .send({ role: "ADMIN" });
    expect(res.status).toBe(400);
    expect(res.body.errors).toContainEqual({ field: "role", message: 'Unknown field "role"' });

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.role).toBe("MEMBER");
  });

  it("rejects an empty update", async () => {
    const { accessToken } = await loginAs("MEMBER");
    const res = await api().patch("/api/v1/users/me").set(bearer(accessToken)).send({});
    expect(res.status).toBe(400);
  });

  it("rejects a non-http avatar URL", async () => {
    const { accessToken } = await loginAs("MEMBER");
    const res = await api()
      .patch("/api/v1/users/me")
      .set(bearer(accessToken))
      .send({ avatarUrl: "javascript:alert(1)" });
    expect(res.status).toBe(400);
    expect(res.body.errors[0].field).toBe("avatarUrl");
  });
});
