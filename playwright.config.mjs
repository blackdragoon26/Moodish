import { defineConfig, devices } from "@playwright/test";

// Browser journeys against the real app with a simulated Swiggy boundary.
// They never reach Swiggy: tests/e2e/server.mjs replaces only that network edge.
export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/*.spec.mjs",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"], trace: "retain-on-failure",
    // The browser can resolve only the local test servers. A missed intercept
    // fails the test instead of reaching Swiggy or any other real service.
    launchOptions: { args: ["--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1"] }
  },
  webServer: [
    { command: "node tests/e2e/server.mjs", env: { E2E_PORT: "8791", E2E_MODE: "live" }, url: "http://127.0.0.1:8791/health", reuseExistingServer: false },
    { command: "node tests/e2e/server.mjs", env: { E2E_PORT: "8792", E2E_MODE: "fixture" }, url: "http://127.0.0.1:8792/health", reuseExistingServer: false }
  ]
});
