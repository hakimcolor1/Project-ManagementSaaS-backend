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
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
