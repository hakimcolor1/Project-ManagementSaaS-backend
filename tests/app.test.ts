import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma.js";
import { api } from "./helpers/factory.js";

afterAll(async () => {
  await prisma.$disconnect();
});

describe("app basics", () => {
  it("GET / describes the API", async () => {
    const res = await api().get("/");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, data: { version: "v1", baseUrl: "/api/v1" } });
  });

  it("GET /api/v1/health reaches the database", async () => {
    const res = await api().get("/api/v1/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, data: { status: "ok", database: "up" } });
  });

  it("unknown routes return 404 in the standard error format", async () => {
    const res = await api().get("/api/v1/does-not-exist");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      success: false,
      message: "Route not found: GET /api/v1/does-not-exist",
      errors: [],
    });
  });

  it("malformed JSON returns 400 in the standard error format", async () => {
    const res = await api()
      .post("/api/v1/auth/login")
      .set("Content-Type", "application/json")
      .send('{"email": ');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      success: false,
      message: "Malformed JSON in request body",
      errors: [],
    });
  });

  it("sends security headers and hides the framework", async () => {
    const res = await api().get("/");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });
});
