import { defineConfig } from "vitest/config";

// Set the test env on process.env at config-load time so that BOTH the
// globalSetup (which runs in vitest's main process and imports db/pool.ts)
// and the forked test workers see them. `test.env` alone only reaches workers.
const TEST_ENV: Record<string, string> = {
  NODE_ENV: "test",
  DATABASE_URL:
    process.env.TEST_DATABASE_URL ??
    "postgres://werejugo:change-me-in-production@localhost:5432/werejugo_test",
  JWT_SECRET: "test-secret",
  STORAGE_DIR: "/tmp/werejugo-test-storage",
  UPLOADS_DIR: "/tmp/werejugo-test-uploads",
};
for (const [k, v] of Object.entries(TEST_ENV)) process.env[k] = v;

export default defineConfig({
  test: {
    globalSetup: ["./src/test/globalSetup.ts"],
    env: TEST_ENV,
    fileParallelism: false,
    pool: "forks",
  },
});
