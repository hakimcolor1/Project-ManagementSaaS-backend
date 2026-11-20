import { execSync } from "node:child_process";
import { config } from "dotenv";
import { toTestDatabaseUrl } from "./test-database-url.js";

/** Runs once before all tests: applies the migrations to the "tasknest_test" schema. */
export default function globalSetup(): void {
  config({ quiet: true });
  const databaseUrl = toTestDatabaseUrl(process.env.DATABASE_URL);

  try {
    execSync("npx prisma migrate deploy", {
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: "pipe",
    });
  } catch (error) {
    const output = (error as { stdout?: Buffer; stderr?: Buffer }) ?? {};
    throw new Error(
      `Could not migrate the test schema:\n${output.stdout?.toString() ?? ""}${output.stderr?.toString() ?? ""}`,
    );
  }
}
