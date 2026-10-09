import { expect, SEED, signIn, test } from "./fixtures";

// 9 Oct (D40): staff see who has reminders on.
test("admin and supervisor see reminder status for interns", async ({ page, consoleErrors }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "one database; run once");
  await signIn(page, SEED.admin);
  await page.goto("/admin/people");
  await expect(page.getByText("Reminders off").locator("visible=true").first()).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("admin-people-reminders.png"), fullPage: true });

  await page.context().clearCookies();
  await page.evaluate(() => localStorage.clear());
  await signIn(page, SEED.supervisors[0]);
  await page.goto("/supervisor/interns");
  await expect(page.getByText("Reminders off").locator("visible=true").first()).toBeVisible();
  expect(consoleErrors).toEqual([]);
});
