import { defineConfig } from "@playwright/test";
import dotenv from "dotenv";
import path from "path";

// Playwright loads no env file itself. Credentials live in .env.test.local (git-ignored).
dotenv.config({ path: path.resolve(__dirname, ".env.test.local") });

const AUTH_FILE = "e2e/.auth/cashier.json";

// Two short viewports. A browser cannot open the Android keyboard, so 1280x400 and
// 800x360 stand in for "a landscape screen with half its height taken". This proves
// the pinned layout only; the real keyboard is checked on the tablet.
const touch = { hasTouch: true, isMobile: true };

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:9003",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  // Start the dev server yourself first (`npm run dev`). It runs `rimraf .next`, so
  // this config only reuses a running server and never starts a second one on 9003.
  webServer: {
    command: "npm run dev",
    url: "http://localhost:9003",
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "landscape-1280x400",
      testMatch: /family-modal-keyboard\.spec\.ts/,
      dependencies: ["setup"],
      use: { browserName: "chromium", viewport: { width: 1280, height: 400 }, storageState: AUTH_FILE, ...touch },
    },
    {
      name: "landscape-800x360",
      testMatch: /family-modal-keyboard\.spec\.ts/,
      dependencies: ["setup"],
      use: { browserName: "chromium", viewport: { width: 800, height: 360 }, storageState: AUTH_FILE, ...touch },
    },
  ],
});
