import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Migrates the separate "tasknest_test" schema once before all tests.
    globalSetup: ["tests/setup/global-setup.ts"],
    // Points every test file at that schema.
    setupFiles: ["tests/setup/test-env.ts"],
    // Test files share one database, so they run one after another.
    fileParallelism: false,
    // Long flows make ~16 API calls against a remote database; 30 s was too tight on slow days.
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
