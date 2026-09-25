import { formatDay, formatTimeOfDay } from "../src/lib/darwin";
import { addUtcDays, clearOfficeClock, expect, nextMonday, setOfficeClock, signIn, signOut, test } from "./fixtures";

// Golden path 2 (§16): intern submits a swap → supervisor approves → the schedule updates.
test.afterEach(() => clearOfficeClock());

test("intern swaps a day and the supervisor approves it", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "golden paths share one seed; run once on mobile");
  const monday = nextMonday();
  const thursday = addUtcDays(monday, 3);
  const friday = addUtcDays(monday, 4);

  setOfficeClock(`${monday}T09:00`);
  await signIn(page, "intern1@dgk.test");
  await expect(page).toHaveURL(/\/clock/);

  await page.getByRole("link", { name: "Schedule" }).click();
  await expect(page).toHaveURL(/\/clock\/schedule/);

  await page.getByRole("button", { name: new RegExp(formatDay(friday)) }).click();
  await page.getByRole("button", { name: /^Swap$/ }).click();

  await page.getByLabel("Move to").fill(thursday);
  await page.getByLabel("Reason").fill("Need Thursday for a uni workshop.");

  const preview = page.getByRole("region", { name: "Preview" });
  await expect(preview).toContainText(formatDay(thursday), { timeout: 15_000 });
  await expect(page.getByRole("button", { name: /^Submit$/ })).toBeEnabled();
  await page.getByRole("button", { name: /^Submit$/ }).click();
  await expect(page.getByText(/Swap sent/i)).toBeVisible();

  await page.getByRole("link", { name: "Requests" }).click();
  await expect(page).toHaveURL(/\/clock\/requests/);
  await page.getByRole("button", { name: /^Pending$/ }).click();
  const pending = page.getByRole("listitem").filter({ hasText: "Swap" }).first();
  await expect(pending).toBeVisible();
  await expect(pending.getByText(/supervisor/i)).toBeVisible();

  await signOut(page);
  await signIn(page, "sup1@dgk.test");
  await page.goto("/supervisor/approvals");
  await page.getByRole("button", { name: /Swap/ }).filter({ hasText: "Aisha" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText(/moves to|office/i);
  await page.getByRole("dialog").getByRole("button", { name: /^Approve$/ }).click();
  await expect(page.getByText(/Swap approved/i)).toBeVisible();

  await signOut(page);
  await signIn(page, "intern1@dgk.test");
  await page.getByRole("link", { name: "Schedule" }).click();

  const oldDay = page.getByRole("button", { name: new RegExp(formatDay(friday)) });
  await expect(oldDay).toContainText(/Moved/i);

  const newDay = page.getByRole("button", { name: new RegExp(formatDay(thursday)) });
  await expect(newDay).toContainText(new RegExp(`${formatTimeOfDay("09:00")}.*${formatTimeOfDay("17:00")}`));
  await expect(newDay).toContainText(/Scheduled/i);

  await page.getByRole("link", { name: "Requests" }).click();
  await page.getByRole("button", { name: /^Decided$/ }).click();
  const decided = page.getByRole("listitem").filter({ hasText: "Swap" }).first();
  await expect(decided).toContainText(/Approved/i);
});
