import request from "supertest";
import app from "../../src/app.js";
import type { Prisma } from "../../src/generated/prisma/client.js";
import type { Role } from "../../src/generated/prisma/enums.js";
import { prisma } from "../../src/lib/prisma.js";
import { hashPassword } from "../../src/utils/password.js";

export const PASSWORD = "Passw0rd!";

export const api = () => request(app);

let counter = 0;

/** Creates a user directly in the database (password: PASSWORD). */
export async function createUser(
  role: Role = "MEMBER",
  overrides: Partial<Prisma.UserCreateInput> = {},
) {
  counter += 1;
  return prisma.user.create({
    data: {
      name: `Test ${role} ${counter}`,
      email: `${role.toLowerCase()}${counter}.${Date.now()}@example.com`,
      role,
      passwordHash: await hashPassword(PASSWORD),
      ...overrides,
    },
  });
}

/** Creates a user and logs in through the API. */
export async function loginAs(role: Role, overrides: Partial<Prisma.UserCreateInput> = {}) {
  const user = await createUser(role, overrides);
  const res = await api()
    .post("/api/v1/auth/login")
    .send({ email: user.email, password: PASSWORD });
  if (res.status !== 200) {
    throw new Error(`Login failed for ${role}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return {
    user,
    accessToken: res.body.data.accessToken as string,
    refreshToken: res.body.data.refreshToken as string,
  };
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
