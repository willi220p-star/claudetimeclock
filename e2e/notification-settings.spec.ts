import { expect, SEED, signIn, test } from "./fixtures";

// 9 Oct (D37): Settings → Notifications. The admin unticks a push, sets one intern's break and
// the same break for everyone.
test("an admin chooses notifications and break lengths", async ({ page, consoleErrors }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "one database; run once");
  await signIn(page, SEED.admin);
  await page.goto("/admin/notifications");
  await expect(page.getByRole("heading", { name: "Notifications", level: 1 })).toBeVisible();

  const shift = page.getByRole("checkbox", { name: /Shift starts in 30 minutes/ });
  await expect(shift).toBeChecked();
  await shift.uncheck();
  await page.getByRole("button", { name: "Save notifications" }).click();
  await expect(page.getByText("Notifications saved.")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("checkbox", { name: /Shift starts in 30 minutes/ })).not.toBeChecked();

  const row = page.getByRole("listitem").filter({ has: page.getByRole("textbox") }).first();
  await row.getByRole("textbox").fill("60");
  await row.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(/break is 60 minutes\./)).toBeVisible();

  await page.getByLabel("Same break for everyone (minutes)").fill("45");
  await page.getByRole("button", { name: "Apply to all active interns" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Apply to all" }).click();
  await expect(page.getByText(/breaks? changed\./)).toBeVisible();
  await expect(page.getByRole("listitem").getByRole("textbox").first()).toHaveValue("45");
  await page.screenshot({ path: test.info().outputPath("notification-settings.png"), fullPage: true });

  // Put the seed back for the specs after this one.
  await page.getByLabel("Same break for everyone (minutes)").fill("30");
  await page.getByRole("button", { name: "Apply to all active interns" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Apply to all" }).click();
  await expect(page.getByRole("listitem").getByRole("textbox").first()).toHaveValue("30");
  await page.getByRole("checkbox", { name: /Shift starts in 30 minutes/ }).check();
  await page.getByRole("button", { name: "Save notifications" }).click();
  await expect(page.getByRole("button", { name: "Save notifications" })).toBeDisabled();
  expect(consoleErrors).toEqual([]);
});
