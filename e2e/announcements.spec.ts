import { expect, SEED, signIn, signOut, test } from "./fixtures";

// 12 Oct (D41): an admin posts a must-acknowledge notice; an intern acknowledges it on Home; the admin sees it.
test("announcement with a read receipt", async ({ page, consoleErrors }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "one database; run once");
  const title = `Office closed ${Date.now() % 100000}`;
  await signIn(page, SEED.admin);
  await page.goto("/admin/announcements");
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Message").fill("Public holiday on Friday. Rest up.");
  await page.getByLabel("For").selectOption("interns");
  await page.getByLabel(/Must be acknowledged/).check();
  await page.getByRole("button", { name: "Post" }).click();
  await expect(page.getByText(/Posted\./)).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: title }).getByText(/0 of \d+ acknowledged/)).toBeVisible();

  await signOut(page);
  await signIn(page, "intern3@dgk.test");
  const card = page.getByRole("region", { name: title });
  await expect(card).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("announcement-home.png"), fullPage: true });
  await card.getByRole("button", { name: "I've read this" }).click();
  await expect(card).toHaveCount(0);

  await signOut(page);
  await signIn(page, SEED.admin);
  await page.goto("/admin/announcements");
  const posted = page.getByRole("listitem").filter({ hasText: title });
  await expect(posted.getByText(/1 of \d+ acknowledged/)).toBeVisible();
  await posted.getByRole("button", { name: "Who read it" }).click();
  await expect(posted.getByText(/Acknowledged/).first()).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("announcement-admin.png"), fullPage: true });
  expect(consoleErrors).toEqual([]);
});
