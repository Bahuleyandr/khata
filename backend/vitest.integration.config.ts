import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    globalSetup: ["src/test-support/integration.setup.ts"],
    pool: "forks",
    // Vitest 4 removed poolOptions.forks.singleFork; a single worker gives the
    // same one-process behaviour these shared-Postgres integration tests need
    // (audit 2026-06-19 #5a follow-up — also clears the deprecation warning).
    maxWorkers: 1,
    minWorkers: 1,
    // All integration tests share one Postgres instance and one connection pool.
    // Force fully sequential execution across files AND within each file to
    // prevent deadlocks and pool exhaustion.
    sequence: {
      concurrent: false,
      shuffle: false,
    },
    // Each test file runs sequentially (no parallelism within the fork).
    fileParallelism: false,
    testTimeout: 120000,
    hookTimeout: 120000,
  },
});
