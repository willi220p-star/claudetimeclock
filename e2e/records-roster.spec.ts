import { addUtcDays, expect, nextMonday, SEED, signIn, test } from "./fixtures";

// 26 Sep requests: add an intern with their roster, see who is working, and manage records.
// Phone-sized only, like the golden paths: every screen has to work there.
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "phone-sized flows");
});

const shot = (name: string) => test.info().outputPath(`${name}.png`);

test("admin adds an intern with a roster, sees them on the roster, then edits and deletes records", async ({
  page,
  consoleErrors,
}) => {
  const stamp = Date.now();
  const name = `Roster Tester ${stamp}`;
  // Two weeks out, where the seed leaves room; four Mondays, Wednesdays and Fridays → 12 days.
  const start = addUtcDays(nextMonday(), 14);
  const end = addUtcDays(start, 25);

  await signIn(page, SEED.admin);
  await page.goto("/admin/people");
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Email", { exact: true }).fill(`roster.${stamp}@dgk.test`);
  await page.getByLabel("Temporary password").fill("Temporary-pass-12");
  await page.locator("#person-supervisor").selectOption({ label: "Priya Raman" });
  await page.getByLabel("University").fill("Charles Darwin University");
  await page.getByLabel("Course").fill("Bachelor of Business");
  await page.getByLabel("Start date").fill(start);
  await page.getByLabel("End date").fill(end);
  await expect(page.getByText(/The roster adds up to 12 days/)).toBeVisible();
  await page.getByRole("button", { name: "Use roster" }).click();
  await expect(page.getByLabel("Target hours")).toHaveValue("90");
  await page.screenshot({ path: shot("add-intern"), fullPage: true });
  await page.getByRole("button", { name: "Add intern and roster" }).click();
  // The seed fills some weekdays to 3 of 3: the database refuses, then an admin may allow extra spots.
  const extra = page.getByLabel("Allow extra spots on full days");
  await expect(page.getByText(`${name} is added with their roster.`).or(extra)).toBeVisible();
  if (await extra.isVisible()) {
    await expect(page.getByRole("alert").filter({ hasText: "extra spot" })).toBeVisible();
    await extra.check();
    await page.getByRole("button", { name: "Add intern and roster" }).click();
  }
  await expect(page.getByText(`${name} is added with their roster.`)).toBeVisible();

  // Roster: week view by default; three weeks on is their first Monday.
  await page.goto("/admin/roster");
  await expect(page.getByRole("button", { name: "Week", pressed: true })).toBeVisible();
  for (let week = 0; week < 3; week++) await page.getByRole("button", { name: "Next week" }).click();
  await expect(page.getByRole("heading", { name: /^Week of/ })).toContainText(/Mon/);
  await expect(page.getByRole("link", { name: new RegExp(name) }).first()).toBeVisible();
  await page.screenshot({ path: shot("roster-week"), fullPage: true });
  await page.getByRole("button", { name: "List" }).click();
  await expect(page.getByRole("link", { name: new RegExp(name) }).first()).toBeVisible();
  await page.getByRole("button", { name: "Month" }).click();
  await page.screenshot({ path: shot("roster-month"), fullPage: true });

  // Records: edit one of their roster days, delete it, then delete the person.
  await page.goto("/admin/records");
  await expect(page.getByRole("heading", { name: "Storage" })).toBeVisible();
  await page.screenshot({ path: shot("records"), fullPage: true });
  await page.getByRole("button", { name: /^Roster days/ }).click();
  await page.getByRole("searchbox", { name: "Search loaded records" }).fill(name);
  await page.getByRole("button", { name: new RegExp(name) }).first().click();
  await page.screenshot({ path: shot("record-sheet"), fullPage: true });
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Start", { exact: true }).fill("10:00");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();

  await page.getByRole("button", { name: new RegExp(name) }).first().click();
  await expect(page.getByText("10:00 am", { exact: false }).first()).toBeVisible();
  await page.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Delete for good" }).click();
  await expect(page.getByText("Deleted.")).toBeVisible();

  await page.getByRole("button", { name: "All tables" }).click();
  await page.getByRole("button", { name: /^People/ }).click();
  await page.getByRole("searchbox", { name: "Search loaded records" }).fill(name);
  await page.getByRole("button", { name: new RegExp(name) }).click();
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText(/The audit log and consent records stay/)).toBeVisible();
  await page.getByRole("button", { name: "Delete for good" }).click();
  await expect(page.getByText("Deleted.")).toBeVisible();
  await expect(page.getByRole("button", { name: new RegExp(name) })).toHaveCount(0);

  expect(consoleErrors).toEqual([]);
});

test("a supervisor sees their roster and views records without edit or delete", async ({ page, consoleErrors }) => {
  await signIn(page, SEED.supervisors[0]);
  await page.goto("/supervisor/roster");
  await expect(page.getByRole("heading", { name: "Roster", level: 1 })).toBeVisible();
  await page.screenshot({ path: shot("supervisor-roster"), fullPage: true });

  await page.goto("/supervisor/records");
  await expect(page.getByText(/View only/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Storage" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Audit log/ })).toHaveCount(0);
  await page.getByRole("button", { name: /^Punches/ }).click();
  await page.getByRole("list").getByRole("button").first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(0);
  await page.screenshot({ path: shot("supervisor-record"), fullPage: true });

  expect(consoleErrors).toEqual([]);
});
