import { clearOfficeClock, expect, nextMonday, setOfficeClock, signIn, test } from "./fixtures";

// Golden path 4 (§16), 5 Oct: the intern picks free office days to catch up; the supervisor approves them.
test.afterEach(() => clearOfficeClock());

test("intern picks catch-up days and sends them", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "golden paths share one seed; run once on mobile");
  setOfficeClock(`${nextMonday()}T09:00`);
  await signIn(page, "intern2@dgk.test");
  await expect(page).toHaveURL(/\/clock/);

  await expect(page.getByRole("heading", { name: "Catch up" })).toBeVisible();
  await page.getByRole("button", { name: "Pick catch-up days" }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByText("Behind by")).toBeVisible();
  await sheet.getByRole("button", { name: "Quick fill" }).click();
  await expect(sheet.getByText(/Covers .+ of .+ owed/)).toBeVisible();
  const picked = sheet.getByRole("listitem").filter({ has: page.getByRole("checkbox", { checked: true }) });
  await expect(picked.first()).toBeVisible();
  await picked.first().getByRole("radio", { name: "Morning" }).click();
  await page.screenshot({ path: test.info().outputPath("catch-up.png"), fullPage: true });

  await sheet.getByRole("button", { name: /^Send \d+ days? to your supervisor$/ }).click();
  await expect(page.getByText(/days? sent to your supervisor/)).toBeVisible();
  await expect(page).toHaveURL(/\/clock\/requests/);
  await page.getByRole("button", { name: /^Pending$/ }).click();
  const extras = page.getByRole("listitem").filter({ hasText: "Extra day" });
  await expect(extras.first()).toBeVisible();
  await expect(extras.first().getByText(/waiting for supervisor/i)).toBeVisible();
});
