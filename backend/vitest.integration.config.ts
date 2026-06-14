import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    globalSetup: ["src/test-support/integration.setup.ts"],
    pool: "forks",
    poolOptions: {
      forks: { singleFork: true },
    },
    // All integration tests share one Postgres instance and one connection pool.
    // Force fully sequential execution across files AND within each file to
    // prevent deadlocks and pool exhaustion.
    sequence: {
      concurrent: false,
      shuffle: false,
    },
    // Each test file runs sequentially (no parallelism within the fork).
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
