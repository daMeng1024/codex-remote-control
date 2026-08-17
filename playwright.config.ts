import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:8790",
    trace: "retain-on-failure",
    launchOptions: { executablePath: "/usr/bin/google-chrome" },
  },
  projects: [
    {
      name: "mobile-390x844",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
      },
    },
    {
      name: "desktop-1440x900",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
  webServer: {
    command: "npm run e2e:fixture -w @codex-remote/server",
    url: "http://127.0.0.1:8790/api/health",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
