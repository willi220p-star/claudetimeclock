import { clearOfficeClock, expect, nextMonday, setOfficeClock, signIn, test } from "./fixtures";

// Golden path 4 (§16): catch-up option B submitted.
test.afterEach(() => clearOfficeClock());

test("intern sends catch-up option B", async ({ page }) => {
  setOfficeClock(`${nextMonday()}T09:00`);
  await signIn(page, "intern2@dgk.test");
  await expect(page).toHaveURL(/\/clock/);

  await expect(page.getByText(/Owed /)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Catch up" })).toBeVisible();
  await page.getByRole("button", { name: /^Catch up$/ }).click();

  const optionB = page.locator("section").filter({ has: page.getByRole("heading", { name: "Option B" }) });
  await expect(optionB).toBeVisible();
  await expect(optionB.getByText(/Covers .+ of .+ owed/)).toBeVisible();
  await expect(optionB.getByRole("button", { name: /^Send requests$/ })).toBeEnabled();
  await optionB.getByRole("button", { name: /^Send requests$/ }).click();
  await expect(page.getByText(/Catch-up requests sent/i)).toBeVisible();

  await page.getByRole("link", { name: "Requests" }).click();
  await expect(page).toHaveURL(/\/clock\/requests/);
  await page.getByRole("button", { name: /^Pending$/ }).click();
  const extras = page.getByRole("listitem").filter({ hasText: "Extra day" });
  await expect(extras.first()).toBeVisible();
  expect(await extras.count()).toBeGreaterThan(0);
  await expect(extras.first().getByText("supervisor", { exact: true })).toBeVisible();
});
