import jwt from "jsonwebtoken";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { env } from "../src/config/env.js";
import { prisma } from "../src/lib/prisma.js";
import { resetDatabase } from "./helpers/db.js";
import { api, bearer, createUser, loginAs, PASSWORD } from "./helpers/factory.js";

beforeAll(resetDatabase);
afterAll(async () => {
  await prisma.$disconnect();
});

const fieldsOf = (body: { errors: Array<{ field: string }> }) => body.errors.map((e) => e.field);

describe("POST /api/v1/auth/register", () => {
  it("creates a MANAGER account and returns tokens", async () => {
    const res = await api().post("/api/v1/auth/register").send({
      name: "Nadia",
      email: "Nadia.Register@Example.com",
      password: "Secret123",
      role: "MANAGER",
    });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user).toMatchObject({
      name: "Nadia",
      email: "nadia.register@example.com",
      role: "MANAGER",
      status: "ACTIVE",
    });
    expect(res.body.data.user).not.toHaveProperty("passwordHash");
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    expect(res.body.data.refreshToken).toEqual(expect.any(String));
  });

  it("uses MEMBER when no role is sent", async () => {
    const res = await api()
      .post("/api/v1/auth/register")
      .send({ name: "Rahim", email: "rahim.register@example.com", password: "Secret123" });
    expect(res.status).toBe(201);
    expect(res.body.data.user.role).toBe("MEMBER");
  });

  it("rejects an email that is already registered (409)", async () => {
    const res = await api()
      .post("/api/v1/auth/register")
      .send({ name: "Copy", email: "NADIA.register@example.com", password: "Secret123" });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ success: false, message: "This email is already registered" });
  });

  it("returns field errors for invalid input (400)", async () => {
    const res = await api()
      .post("/api/v1/auth/register")
      .send({ name: "N", email: "not-an-email", password: "short" });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe("Validation failed");
    expect(fieldsOf(res.body)).toEqual(expect.arrayContaining(["name", "email", "password"]));
  });

  it("never allows signing up as ADMIN", async () => {
    const res = await api()
      .post("/api/v1/auth/register")
      .send({ name: "Hacker", email: "hacker@example.com", password: "Secret123", role: "ADMIN" });
    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual([{ field: "role", message: "Role must be MANAGER or MEMBER" }]);
  });

  it("rejects unknown fields", async () => {
    const res = await api().post("/api/v1/auth/register").send({
      name: "Extra",
      email: "extra@example.com",
      password: "Secret123",
      status: "ACTIVE",
    });
    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual([{ field: "status", message: 'Unknown field "status"' }]);
  });
});

describe("POST /api/v1/auth/login", () => {
  it("logs in with the right password", async () => {
    const user = await createUser("MEMBER");
    const res = await api()
      .post("/api/v1/auth/login")
      .send({ email: user.email.toUpperCase(), password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.data.user).toMatchObject({ id: user.id, role: "MEMBER" });
    expect(res.body.data.accessToken).toEqual(expect.any(String));
  });

  it("gives the same 401 for a wrong password and an unknown email", async () => {
    const user = await createUser("MEMBER");
    const wrongPassword = await api()
      .post("/api/v1/auth/login")
      .send({ email: user.email, password: "Wrong1234" });
    const unknownEmail = await api()
      .post("/api/v1/auth/login")
      .send({ email: "nobody@example.com", password: "Wrong1234" });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body).toEqual(unknownEmail.body);
    expect(wrongPassword.body.message).toBe("Invalid email or password");
  });

  it("refuses a blocked account (403)", async () => {
    const user = await createUser("MEMBER", { status: "BLOCKED" });
    const res = await api()
      .post("/api/v1/auth/login")
      .send({ email: user.email, password: PASSWORD });
    expect(res.status).toBe(403);
  });
});

describe("protected routes", () => {
  it("need a Bearer token (401)", async () => {
    const res = await api().get("/api/v1/users/me");
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it("reject a fake token (401)", async () => {
    const res = await api().get("/api/v1/users/me").set(bearer("not.a.real.token"));
    expect(res.status).toBe(401);
    expect(res.body.message).toBe("Invalid access token");
  });

  it("reject an expired token (401)", async () => {
    const user = await createUser("MEMBER");
    const expired = jwt.sign({ role: "MEMBER" }, env.JWT_ACCESS_SECRET, {
      subject: user.id,
      issuer: "tasknest-api",
      expiresIn: -10,
    });
    const res = await api().get("/api/v1/users/me").set(bearer(expired));
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/expired/);
  });

  it("stop working at once when the user gets blocked (403)", async () => {
    const { user, accessToken } = await loginAs("MEMBER");
    await prisma.user.update({ where: { id: user.id }, data: { status: "BLOCKED" } });
    const res = await api().get("/api/v1/users/me").set(bearer(accessToken));
    expect(res.status).toBe(403);
  });
});

describe("refresh tokens and logout", () => {
  it("rotates the refresh token and detects reuse of the old one", async () => {
    const { refreshToken: first } = await loginAs("MEMBER");

    const rotated = await api().post("/api/v1/auth/refresh-token").send({ refreshToken: first });
    expect(rotated.status).toBe(200);
    const second = rotated.body.data.refreshToken as string;
    expect(second).not.toBe(first);
    expect(rotated.body.data.accessToken).toEqual(expect.any(String));

    // Using the old token again is treated as theft: it fails and ends all sessions.
    const reused = await api().post("/api/v1/auth/refresh-token").send({ refreshToken: first });
    expect(reused.status).toBe(401);
    const afterReuse = await api()
      .post("/api/v1/auth/refresh-token")
      .send({ refreshToken: second });
    expect(afterReuse.status).toBe(401);
  });

  it("logout revokes every refresh token of the user", async () => {
    const { accessToken, refreshToken } = await loginAs("MANAGER");

    const res = await api().post("/api/v1/auth/logout").set(bearer(accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data.revokedSessions).toBeGreaterThanOrEqual(1);

    const refreshed = await api().post("/api/v1/auth/refresh-token").send({ refreshToken });
    expect(refreshed.status).toBe(401);
  });

  it("rejects a refresh token that is not a valid token", async () => {
    const res = await api().post("/api/v1/auth/refresh-token").send({ refreshToken: "garbage" });
    expect(res.status).toBe(401);
  });

  it("requires the refreshToken field (400)", async () => {
    const res = await api().post("/api/v1/auth/refresh-token").send({});
    expect(res.status).toBe(400);
    expect(fieldsOf(res.body)).toEqual(["refreshToken"]);
  });
});

describe("Google login", () => {
  it("redirects to Google, or answers 503 when it is not configured", async () => {
    const res = await api().get("/api/v1/auth/google?role=MANAGER");
    if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
      expect(res.status).toBe(302);
      expect(res.headers.location).toContain("accounts.google.com");
      expect(String(res.headers["set-cookie"])).toContain("tasknest_oauth_state=");
    } else {
      expect(res.status).toBe(503);
      expect(res.body.message).toBe("Google login is not configured on this server");
    }
  });

  it("rejects a callback without a matching state (400)", async () => {
    const res = await api().get("/api/v1/auth/google/callback?code=abc&state=xyz");
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("rejects an invalid role (400)", async () => {
    const res = await api().get("/api/v1/auth/google?role=ADMIN");
    expect(res.status).toBe(400);
  });
});
