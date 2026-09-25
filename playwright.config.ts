import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { chromium, defineConfig, devices } from "@playwright/test";

// ponytail: some containers ship one pre-installed Chromium under PLAYWRIGHT_BROWSERS_PATH and forbid
// `playwright install`. If the revision this @playwright/test expects is missing, use the newest one there.
// Elsewhere `npx playwright install chromium` makes the expected path exist and this stays undefined.
function fallbackChromium(): string | undefined {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (existsSync(chromium.executablePath()) || !root || !existsSync(root)) return undefined;
  return readdirSync(root)
    .filter((dir) => /^chromium-\d+$/.test(dir))
    .sort((a, b) => Number(b.slice(9)) - Number(a.slice(9)))
    .flatMap((dir) => ["chrome-linux64", "chrome-linux"].map((sub) => path.join(root, dir, sub, "chrome")))
    .find((file) => existsSync(file));
}

export default defineConfig({
  testDir: "e2e",
  outputDir: "e2e/test-results",
  globalSetup: "./e2e/global-setup.ts",
  // Golden paths share one local database and a database-wide test clock, so run one test at a time.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:41731",
    timezoneId: "Australia/Darwin",
    locale: "en-AU",
    permissions: ["geolocation", "camera"],
    // Regus, Level 1, 1 Palmerston Circuit (the seeded site). Move with moveTo() from e2e/fixtures.ts.
    geolocation: { latitude: -12.4785082, longitude: 130.9854825, accuracy: 10 },
    launchOptions: {
      executablePath: fallbackChromium(),
      args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
    },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "mobile",
      use: {
        browserName: "chromium",
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 3,
        // A phone user agent, so punches are not flagged desktop_ua.
        userAgent: devices["Pixel 7"].userAgent,
      },
    },
    {
      name: "desktop",
      use: { browserName: "chromium", viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:41731",
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
