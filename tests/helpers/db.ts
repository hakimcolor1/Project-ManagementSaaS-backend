import { prisma } from "../../src/lib/prisma.js";
import { TEST_SCHEMA } from "../setup/test-database-url.js";

const TABLES = [
  "audit_logs",
  "comments",
  "payments",
  "tasks",
  "project_members",
  "projects",
  "refresh_tokens",
  "users",
];

/** Empties every TaskNest table, but only inside the "tasknest_test" schema. */
export async function resetDatabase(): Promise<void> {
  const schema = new URL(process.env.DATABASE_URL ?? "").searchParams.get("schema");
  if (schema !== TEST_SCHEMA) {
    throw new Error(`Refusing to clean the database: tests must use the "${TEST_SCHEMA}" schema`);
  }
  const tables = TABLES.map((table) => `"${TEST_SCHEMA}"."${table}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables} CASCADE`);
}
