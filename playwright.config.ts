import { defineConfig, devices } from "@playwright/test";

const PORT = 3101;
export const E2E_DB = "file:./e2e.db?connection_limit=1&socket_timeout=30";

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: "pt-BR",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/entrar`,
    timeout: 180_000,
    reuseExistingServer: false,
    env: { DATABASE_URL: E2E_DB, APP_URL: `http://localhost:${PORT}`, PAYMENTS_PROVIDER: "mock", PIX_PROVIDER: "mock", NEXT_TELEMETRY_DISABLED: "1" },
  },
});
