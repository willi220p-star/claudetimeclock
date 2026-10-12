import { addUtcDays, expect, nextMonday, SEED, signIn, signOut, test } from "./fixtures";

// D47 (13 Oct): an intern can be added with no end date and no target. The placement shows
// "No end date", and their Progress shows hours done with no forecast or pace.
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "phone-sized flows");
  test.setTimeout(90_000); // admin, then the intern's first sign-in
});

const shot = (name: string) => test.info().outputPath(`${name}.png`);

test("admin adds an intern with no end date; the intern sees hours done without a forecast", async ({ page, consoleErrors }) => {
  const stamp = Date.now();
  const name = `Open Ended ${stamp}`;
  const email = `open.${stamp}@dgk.test`;
  const start = addUtcDays(nextMonday(), 28);

  await signIn(page, SEED.admin);
  await page.goto("/admin/people");
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Temporary password").fill("Temporary-pass-12");
  await page.locator("#person-supervisor").selectOption({ label: "Priya Raman" });
  await page.getByLabel("University").fill("Charles Darwin University");
  await page.getByLabel("Course").fill("Bachelor of Business");
  await page.getByLabel("Start date").fill(start);
  // End date and target hours stay blank.
  await expect(page.getByLabel("End date (optional — leave blank if not known)")).toHaveValue("");
  await expect(page.getByLabel("Target hours (optional)")).toHaveValue("");
  await page.screenshot({ path: shot("add-open-ended"), fullPage: true });
  await page.getByRole("button", { name: "Add intern and roster" }).click();
  const extra = page.getByLabel("Allow extra spots on full days");
  await expect(page.getByText(`${name} is added with their roster.`).or(extra)).toBeVisible();
  if (await extra.isVisible()) {
    await extra.check();
    await page.getByRole("button", { name: "Add intern and roster" }).click();
  }
  await expect(page.getByText(`${name} is added with their roster.`)).toBeVisible();

  // The placement reads "No end date" and "No target".
  await page.goto("/admin/placements");
  await page.getByRole("link", { name }).first().click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
  await expect(page.getByText(/– No end date/)).toBeVisible();
  await expect(page.getByText("No target")).toBeVisible();
  await page.screenshot({ path: shot("placement-no-end-date"), fullPage: true });
  await signOut(page);

  // The intern's first sign-in, then Progress: hours done, no forecast, no pace.
  await signIn(page, email, "Temporary-pass-12");
  await expect(page.getByRole("heading", { name: "Choose your own password" })).toBeVisible();
  await page.getByLabel("New password").fill("Open-ended-pass-1");
  await page.getByLabel("Type it again").fill("Open-ended-pass-1");
  await page.getByRole("button", { name: "Save password" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/set-password"));
  await page.goto("/clock/progress");
  await expect(page.getByText("0h done · 0h this week")).toBeVisible();
  await expect(page.getByText(/^Finishes /)).toHaveCount(0);
  await expect(page.getByText("Can't forecast")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Hours to target" })).toHaveCount(0);
  await page.screenshot({ path: shot("progress-open-ended"), fullPage: true });
  await signOut(page);

  // Clean up: the admin deletes the account.
  await signIn(page, SEED.admin);
  await page.goto("/admin/people");
  const row = page.getByRole("listitem").filter({ has: page.getByText(name, { exact: true }) });
  await row.getByRole("button", { name: "Delete account" }).click();
  await page.getByRole("button", { name: "Delete for good" }).click();
  await expect(page.getByText(`${name} and everything about them is deleted.`)).toBeVisible();
  expect(consoleErrors).toEqual([]);
});
