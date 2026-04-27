import { defineConfig, devices } from "@playwright/test";

const RUN_AGAINST_DEV_HUB = process.env.RUN_AGAINST_DEV_HUB === "1";

const FRONTEND_URL =
  process.env.PLAYWRIGHT_FRONTEND_URL ?? "http://localhost:1420";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  timeout: 30_000,
  expect: { timeout: 5_000 },

  use: {
    baseURL: FRONTEND_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    headless: true,
    viewport: { width: 1280, height: 800 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Team9PlaywrightE2E",
  },

  projects: [
    {
      name: "ahand-mock",
      testDir: "./tests/e2e/ahand",
      use: {
        ...devices["Desktop Chrome"],
        baseURL: FRONTEND_URL,
      },
      metadata: {
        mode: "mock",
        runAgainstDevHub: false,
      },
    },
    ...(RUN_AGAINST_DEV_HUB
      ? [
          {
            name: "ahand-live",
            testDir: "./tests/e2e/ahand",
            use: {
              ...devices["Desktop Chrome"],
              baseURL: FRONTEND_URL,
            },
            metadata: {
              mode: "live",
              runAgainstDevHub: true,
              gatewayBaseUrl:
                process.env.AHAND_GATEWAY_BASE_URL ??
                "https://api.dev.team9.ai",
            },
          },
        ]
      : []),
  ],

  webServer: process.env.PLAYWRIGHT_NO_WEBSERVER
    ? undefined
    : {
        command:
          "VITE_E2E_MOCK=1 pnpm exec vite --host 127.0.0.1 --port 1420 --strictPort",
        url: FRONTEND_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        stdout: "pipe",
        stderr: "pipe",
      },
});
