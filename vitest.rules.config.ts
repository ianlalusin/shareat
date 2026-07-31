import { defineConfig } from "vitest/config";

/**
 * Firestore security-rules tests. Kept separate from vitest.config.ts so
 * `npm test` stays fast and emulator-free — this config is only used by
 * `npm run test:rules`, which boots the Firestore emulator around it.
 *
 * Requires Java on PATH (the emulator is a JVM process).
 */
export default defineConfig({
  test: {
    include: ["tests/rules/**/*.test.ts"],
    environment: "node",
    // Rules tests share one emulator instance and clear it between cases, so
    // they must not run concurrently.
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
