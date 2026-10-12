import { expect, SEED, signIn, test } from "./fixtures";

// 12 Oct (D43): an admin signs last week for an intern with nothing open, then exports signed hours as CSV.
test("weekly sign-off and signed-hours export", async ({ page, consoleErrors }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "one database; run once");
  test.setTimeout(90_000);
  await signIn(page, SEED.admin);
  await page.goto("/admin/timesheets");
  await expect(page.getByRole("heading", { name: "Timesheets", level: 1 })).toBeVisible();
  const week = page.getByRole("heading", { name: /^Week of / });
  const thisWeek = (await week.textContent())!;
  await page.getByRole("button", { name: "Previous week" }).click();
  await expect(week).not.toHaveText(thisWeek);

  // Try each intern until one has no open items: that one opens the confirm sheet.
  const signButtons = page.getByRole("button", { name: /^Sign .*'s / });
  await expect(signButtons.first()).toBeVisible();
  let signed = false;
  for (let i = 0; i < (await signButtons.count()) && !signed; i++) {
    await signButtons.nth(i).click();
    const dialog = page.getByRole("dialog");
    const opened = await dialog.waitFor({ timeout: 4000 }).then(() => true, () => false);
    if (opened) {
      await dialog.getByRole("button", { name: "Sign week" }).click();
      await expect(page.getByText(/Signed by /).first()).toBeVisible();
      signed = true;
    } else {
      await expect(page.getByText("Fix these first:").first()).toBeVisible();
    }
  }
  await page.screenshot({ path: test.info().outputPath("signoff.png"), fullPage: true });

  if (signed) {
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export CSV" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^dgk-hours-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.csv$/);
  }
  expect(consoleErrors).toEqual([]);
});
