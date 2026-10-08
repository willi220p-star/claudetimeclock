import { expect, SEED, signIn, signOut, test } from "./fixtures";

// 8 Oct (Dilip), PR 2: KPI cards open the list behind them, the detailed intern profile with
// filters, and Progress charts for intern, supervisor and admin.
test("dashboards click through; profile timesheet filters; Progress charts on every desk", async ({ page, consoleErrors }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "one database; run once");
  test.setTimeout(90_000);

  await signIn(page, SEED.supervisors[0]);
  await page.getByRole("link", { name: /^Approvals waiting/ }).click();
  await expect(page).toHaveURL(/\/supervisor\/approvals/);

  await page.goto("/supervisor/interns");
  await page.getByRole("link", { name: /Aisha/ }).first().click();
  await expect(page).toHaveURL(/\/supervisor\/intern/);
  await expect(page.getByRole("tab", { name: "Timesheet" })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "Absent" }).click();
  await expect(page.getByRole("button", { name: "Absent" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("tab", { name: "Selfies" }).click();

  await page.goto("/supervisor/progress");
  await expect(page.getByRole("heading", { name: "Progress", level: 1 })).toBeVisible();
  await expect(page.getByText("Show the numbers").first()).toBeVisible();
  await signOut(page);

  await signIn(page, SEED.admin);
  await page.goto("/admin/progress");
  await expect(page.getByRole("heading", { name: "Progress", level: 1 })).toBeVisible();
  await expect(page.getByText("Show the numbers").first()).toBeVisible();
  await signOut(page);

  await signIn(page, SEED.interns[0]);
  await page.getByRole("link", { name: "Progress" }).click();
  await expect(page.getByText(/^This week · /)).toBeVisible();
  await expect(page.getByText("Attendance so far")).toBeVisible();
  expect(consoleErrors).toEqual([]);
});
