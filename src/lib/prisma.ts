import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "../config/env.js";
import { Prisma, PrismaClient } from "../generated/prisma/client.js";

/** The Postgres schema from DATABASE_URL (`&schema=tasknest`, tests: `tasknest_test`). */
export const databaseSchema = new URL(env.DATABASE_URL).searchParams.get("schema") ?? "public";

if (!/^[a-z_][a-z0-9_]*$/i.test(databaseSchema)) {
  throw new Error("The schema name in DATABASE_URL may only contain letters, digits and _");
}

/**
 * DATABASE_URL ends with `&schema=tasknest`. Prisma Migrate reads that parameter itself;
 * at runtime we pass it to the pg adapter instead, so every query targets the TaskNest schema.
 */
function createPrismaClient(): PrismaClient {
  const url = new URL(env.DATABASE_URL);
  url.searchParams.delete("schema");

  const adapter = new PrismaPg({ connectionString: url.toString() }, { schema: databaseSchema });
  return new PrismaClient({ adapter });
}

// One client per process. In development it is kept on globalThis so hot reloads
// (tsx watch) do not open a new connection pool every time.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (env.NODE_ENV === "development") {
  globalForPrisma.prisma = prisma;
}

export type Tx = Prisma.TransactionClient;

/** Interactive transactions talk to a remote database, so they get more time than the default 5 s. */
export const TX_OPTIONS = { maxWait: 10_000, timeout: 20_000 } as const;

/**
 * `SELECT … FOR UPDATE` on one row, inside a transaction. A second transaction that locks the
 * same row waits until the first one commits, so "count, then insert" checks cannot race.
 */
export async function lockRow(tx: Tx, table: "users" | "projects", id: string): Promise<void> {
  const target = Prisma.raw(`"${databaseSchema}"."${table}"`);
  await tx.$queryRaw`SELECT id FROM ${target} WHERE id = ${id}::uuid FOR UPDATE`;
}
