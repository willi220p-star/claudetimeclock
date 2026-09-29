import { addUtcDays, expect, nextMonday, SEED, signIn, signOut, test } from "./fixtures";

// 29 Sep requests: the new Home and profile, announcement banners, supervisor roster edits and
// deleting an account from People. Phone-sized, like the golden paths.
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "phone-sized flows");
  test.setTimeout(90_000); // long multi-person flows
});

const shot = (name: string) => test.info().outputPath(`${name}.png`);

test("an intern sees the new Home and edits their own profile", async ({ page, consoleErrors }) => {
  await signIn(page, "intern3@dgk.test");
  await expect(page.getByRole("heading", { name: /Hi Chloe/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /^Your roster:/ })).toBeVisible();
  await page.screenshot({ path: shot("home"), fullPage: true });

  await page.getByRole("link", { name: "Me" }).click();
  const profile = page.getByRole("region", { name: "Chloe Martin" });
  await expect(profile.getByText("Tom Walsh")).toBeVisible();
  await expect(profile.getByRole("link", { name: "Change password" })).toHaveAttribute("href", /set-password/);
  await profile.getByRole("button", { name: "Edit name" }).click();
  await page.getByLabel("Your name").fill("Chloe M. Martin");
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(page.getByText("Name saved.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Chloe M. Martin" })).toBeVisible();
  await page.screenshot({ path: shot("me"), fullPage: true });

  // Put the seed name back for the other tests.
  await page.getByRole("button", { name: "Edit name" }).click();
  await page.getByLabel("Your name").fill("Chloe Martin");
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(page.getByRole("heading", { name: "Chloe Martin" })).toBeVisible();
  expect(consoleErrors).toEqual([]);
});

test("an admin posts a moving banner; an intern sees it and hides it", async ({ page }) => {
  const message = `E2E notice ${Date.now()}`;
  await signIn(page, SEED.admin);
  await page.goto("/admin/settings");
  await page.getByLabel("Message").fill(message);
  await page.getByRole("radio", { name: "Moving text" }).click();
  await page.getByRole("button", { name: "Post banner" }).click();
  await expect(page.getByText("Banner posted to everyone.")).toBeVisible();
  await signOut(page);

  await signIn(page, "intern3@dgk.test");
  const banner = page.getByRole("status", { name: "Announcement" }).filter({ hasText: message });
  await expect(banner).toBeVisible();
  await page.screenshot({ path: shot("banner") });
  await banner.getByRole("button", { name: "Hide this announcement" }).click();
  await expect(banner).toHaveCount(0);
  await signOut(page);

  // Clean up so the banner doesn't sit over the other tests.
  await signIn(page, SEED.admin);
  await page.goto("/admin/settings");
  await page.getByRole("listitem").filter({ hasText: message }).getByRole("button", { name: "End" }).click();
  await expect(page.getByText("Banner ended.")).toBeVisible();
});

test("a supervisor moves a day and sets a date-range pattern; the admin deletes the account", async ({ page, consoleErrors }) => {
  const stamp = Date.now();
  const name = `Roster Edit ${stamp}`;
  const start = addUtcDays(nextMonday(), 21);

  // Admin adds an intern for Priya, Mon/Wed/Fri 9–5, four weeks.
  await signIn(page, SEED.admin);
  await page.goto("/admin/people");
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Email", { exact: true }).fill(`edit.${stamp}@dgk.test`);
  await page.getByLabel("Temporary password").fill("Temporary-pass-12");
  await page.locator("#person-supervisor").selectOption({ label: "Priya Raman" });
  await page.getByLabel("University").fill("Charles Darwin University");
  await page.getByLabel("Course").fill("Bachelor of Business");
  await page.getByLabel("Start date").fill(start);
  await page.getByLabel("End date").fill(addUtcDays(start, 25));
  await page.getByRole("button", { name: "Use roster" }).click();
  await page.getByRole("button", { name: "Add intern and roster" }).click();
  const extra = page.getByLabel("Allow extra spots on full days");
  await expect(page.getByText(`${name} is added with their roster.`).or(extra)).toBeVisible();
  if (await extra.isVisible()) {
    await extra.check();
    await page.getByRole("button", { name: "Add intern and roster" }).click();
  }
  await expect(page.getByText(`${name} is added with their roster.`)).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: name }).filter({ hasText: "Supervisor: Priya Raman" })).toHaveCount(1);
  await expect(page.getByRole("listitem").filter({ hasText: /^Priya Raman/ }).filter({ hasText: `Supervises:` })).toContainText(name);
  await signOut(page);

  // Priya changes one day's times, then Wednesdays only for the first two weeks.
  await signIn(page, SEED.supervisors[0]);
  await page.goto("/supervisor/roster");
  for (let week = 0; week < 4; week++) await page.getByRole("button", { name: "Next week" }).click();
  await page.getByRole("button", { name: new RegExp(`Change ${name}`) }).first().click();
  await page.getByLabel("Start", { exact: true }).selectOption("10:00");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Times changed.")).toBeVisible();
  await expect(page.getByText("10:00 am–5:00 pm").first()).toBeVisible();

  await page.getByRole("button", { name: "Change days" }).click();
  await page.getByLabel("Intern").selectOption({ label: name });
  await page.getByLabel("From").fill(start);
  await page.getByLabel("Until (optional)").fill(addUtcDays(start, 13));
  await page.getByLabel("Mon", { exact: true }).uncheck();
  await page.getByLabel("Fri", { exact: true }).uncheck();
  await page.screenshot({ path: shot("change-days"), fullPage: true });
  await page.getByRole("button", { name: "Save days" }).click();
  const extraSpot = page.getByLabel("Allow an extra spot on full days");
  await expect(page.getByText(/^Days changed from/).or(extraSpot)).toBeVisible();
  if (await extraSpot.isVisible()) {
    await extraSpot.check();
    await page.getByRole("button", { name: "Save days" }).click();
  }
  await expect(page.getByText(/^Days changed from/)).toBeVisible();
  // Wednesday from the new pattern, plus the Monday edited by hand (single-day edits survive pattern changes).
  await expect(page.getByRole("button", { name: new RegExp(`Change ${name}`) })).toHaveCount(2);
  await page.screenshot({ path: shot("supervisor-roster-edited"), fullPage: true });
  await signOut(page);

  // Admin deletes the account from People.
  await signIn(page, SEED.admin);
  await page.goto("/admin/people");
  const row = page.getByRole("listitem").filter({ has: page.getByText(name, { exact: true }) });
  await row.getByRole("button", { name: "Delete account" }).click();
  await expect(page.getByText(/Nothing that names them is kept/)).toBeVisible();
  await page.getByRole("button", { name: "Delete for good" }).click();
  await expect(page.getByText(`${name} and everything about them is deleted.`)).toBeVisible();
  await expect(row).toHaveCount(0);
  expect(consoleErrors).toEqual([]);
});
