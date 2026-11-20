export const TEST_SCHEMA = "tasknest_test";

/** Same database as development, but the separate "tasknest_test" schema. */
export function toTestDatabaseUrl(databaseUrl: string | undefined): string {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is missing. Add it to .env before running tests.");
  }
  const url = new URL(databaseUrl);
  url.searchParams.set("schema", TEST_SCHEMA);
  return url.toString();
}
