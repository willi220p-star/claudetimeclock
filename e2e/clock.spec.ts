import { clearOfficeClock, expect, moveTo, setOfficeClock, signIn, test } from "./fixtures";

// Golden path 1 (§16): an intern clocks in, takes a break and clocks out on a phone (5 Oct: one
// clock sheet with a drawn office map, live selfie, Start · Break · Finish; Finish needs the log).
// Aisha (intern1) works Mondays, Wednesdays and Fridays 9:00–5:00 in the seed.
function nextMonday() {
  const now = new Date();
  const day = now.getUTCDay();
  const add = ((8 - day) % 7) || 7;
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + add));
  return monday.toISOString().slice(0, 10);
}

type Page = import("@playwright/test").Page;
const shot = (name: string) => test.info().outputPath(`${name}.png`);

/** Open the clock sheet from Home, press its action, take and keep the selfie. */
async function clock(page: Page, home: RegExp, action: RegExp) {
  await page.getByRole("button", { name: home }).first().click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByText(/from Regus Palmerston/)).toBeVisible();
  await sheet.getByRole("button", { name: action }).click();
  return sheet;
}

async function selfie(sheet: import("@playwright/test").Locator) {
  await sheet.getByRole("button", { name: /take photo/i }).click();
  await sheet.getByRole("button", { name: /use photo/i }).click();
}

test.afterEach(() => clearOfficeClock());

test("intern clocks in, takes a break and clocks out", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "the clock is a phone flow");
  test.setTimeout(90_000);
  const day = nextMonday();

  setOfficeClock(`${day}T08:55`);
  await signIn(page, "intern1@dgk.test");
  await expect(page).toHaveURL(/\/clock/);

  // Too far away: the map says so, and the database refuses with how far.
  await moveTo(page, 300);
  let sheet = await clock(page, /^clock in$/i, /^clock in$/i);
  await expect(sheet.getByText(/move within 200 m/)).toBeVisible();
  await selfie(sheet);
  await expect(sheet.getByText(/from the office\. Move closer to clock in\./)).toBeVisible();

  // At the office: clock in with a live selfie.
  await moveTo(page, 0);
  await page.reload();
  sheet = await clock(page, /^clock in$/i, /^clock in$/i);
  await page.screenshot({ path: shot("clock-sheet") });
  await selfie(sheet);
  await expect(page.getByText(/clocked in since/i)).toBeVisible();

  // Noon: Break is open (10 am–2 pm).
  setOfficeClock(`${day}T12:00`);
  await page.reload();
  sheet = await clock(page, /^start break$/i, /^start break$/i);
  await selfie(sheet);
  await expect(page.getByText(/on a break since/i)).toBeVisible();

  setOfficeClock(`${day}T12:30`);
  await page.reload();
  sheet = await clock(page, /^end break$/i, /^end break$/i);
  await selfie(sheet);
  await expect(page.getByText(/clocked in since/i)).toBeVisible();
  await expect(page.getByText(/^Break 30m$/)).toBeVisible();

  // Later that day: Finish asks for the work log first, then clocks out.
  setOfficeClock(`${day}T16:55`);
  await page.reload();
  sheet = await clock(page, /^clock out$/i, /^clock out$/i);
  await sheet.getByLabel(/^Work log for /).fill("Cleaned up the CRM export and tagged the leads by industry.");
  await page.screenshot({ path: shot("finish-log") });
  await sheet.getByRole("button", { name: "Save log and clock out" }).click();
  await selfie(sheet);
  // The browser clock is real time while the office clock is frozen, so check the server's stamp.
  await expect(page.getByText(/clocked out at 4:55 pm/i).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /^clock in$/i })).toBeVisible();
  await page.screenshot({ path: shot("home-after"), fullPage: true });
});
