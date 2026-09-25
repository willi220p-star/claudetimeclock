import { clearOfficeClock, expect, SEED, signIn, signOut, test } from "./fixtures";

// Golden path 5 (§16, §13): supervisor approves the uni report; only then can the intern download the PDF.
test.afterEach(() => clearOfficeClock());

test("supervisor approves the uni report", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "golden paths share one seed; run once on mobile");
  await signIn(page, "intern5@dgk.test");
  await page.getByRole("link", { name: "Me" }).click();
  await expect(page).toHaveURL(/\/clock\/me/);
  await expect(page.getByText(/approves the uni report/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /download report/i })).toHaveCount(0);
  await signOut(page);

  await signIn(page, SEED.supervisors[1]);
  await page.goto("/supervisor/interns");
  await page.getByRole("link", { name: /Fatima/ }).first().click();
  await expect(page).toHaveURL(/\/supervisor\/intern/);

  await page.getByRole("button", { name: /Approve uni report/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: /^Confirm$/ }).click();
  await expect(page.getByText(/Uni report/)).toContainText(/approved/i);
  await expect(page.getByText(/Tom Walsh/)).toBeVisible();

  await signOut(page);
  await signIn(page, "intern5@dgk.test");
  await page.getByRole("link", { name: "Me" }).click();
  await expect(page).toHaveURL(/\/clock\/me/);
  await expect(page.getByText(/your uni report is approved/i)).toBeVisible();
  await expect(page.getByText(/Tom Walsh/)).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download report (PDF)" }).click();
  expect((await download).suggestedFilename()).toMatch(/^Hours-report-Fatima-Ali-DGK-[0-9A-F]{8}-[0-9A-F]{8}\.pdf$/);
});
