import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./src/test/globalSetup.ts"],
    env: {
      NODE_ENV: "test",
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        "postgres://werejugo:change-me-in-production@localhost:5432/werejugo_test",
      JWT_SECRET: "test-secret",
      STORAGE_DIR: "/tmp/werejugo-test-storage",
      UPLOADS_DIR: "/tmp/werejugo-test-uploads",
    },
    fileParallelism: false,
    pool: "forks",
  },
});
