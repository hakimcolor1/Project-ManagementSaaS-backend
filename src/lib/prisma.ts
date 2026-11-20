import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "../config/env.js";
import { PrismaClient } from "../generated/prisma/client.js";

/**
 * DATABASE_URL ends with `&schema=tasknest`. Prisma Migrate reads that parameter itself;
 * at runtime we pass it to the pg adapter instead, so every query targets the TaskNest schema.
 */
function createPrismaClient(): PrismaClient {
  const url = new URL(env.DATABASE_URL);
  const schema = url.searchParams.get("schema") ?? "public";
  url.searchParams.delete("schema");

  const adapter = new PrismaPg({ connectionString: url.toString() }, { schema });
  return new PrismaClient({ adapter });
}

// One client per process. In development it is kept on globalThis so hot reloads
// (tsx watch) do not open a new connection pool every time.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (env.NODE_ENV === "development") {
  globalForPrisma.prisma = prisma;
}
