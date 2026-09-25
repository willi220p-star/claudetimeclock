import { clearOfficeClock, expect, moveTo, setOfficeClock, signIn, test } from "./fixtures";

// Golden path 1 (§16): an intern clocks in and out on a phone. Aisha (intern1) works Mondays,
// Wednesdays and Fridays 9:00–5:00 in the seed, with every work log written.
function nextMonday() {
  const now = new Date();
  const day = now.getUTCDay();
  const add = ((8 - day) % 7) || 7;
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + add));
  return monday.toISOString().slice(0, 10);
}

async function selfie(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: /take photo/i }).click();
  await page.getByRole("button", { name: /use photo/i }).click();
}

test.afterEach(() => clearOfficeClock());

test("intern clocks in and out", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "the clock is a phone flow");
  const day = nextMonday();

  setOfficeClock(`${day}T08:55`);
  await signIn(page, "intern1@dgk.test");
  await expect(page).toHaveURL(/\/clock/);

  // Too far away: the database refuses and says how far.
  await moveTo(page, 300);
  await page.getByRole("button", { name: /^clock in$/i }).click();
  await selfie(page);
  await expect(page.getByText(/from the office\. Move closer to clock in\./)).toBeVisible();

  // At the office: clock in with a live selfie.
  await moveTo(page, 0);
  await page.reload();
  await page.getByRole("button", { name: /^clock in$/i }).click();
  await selfie(page);
  await expect(page.getByText(/in since/i)).toBeVisible();

  // Later that day: clock out.
  setOfficeClock(`${day}T16:55`);
  await page.reload();
  await page.getByRole("button", { name: /clock out/i }).first().click();
  await selfie(page);
  // The browser clock is real time while the office clock is frozen, so check the server's stamp.
  await expect(page.getByText(/clocked out at 4:55 pm/i)).toBeVisible();
});
