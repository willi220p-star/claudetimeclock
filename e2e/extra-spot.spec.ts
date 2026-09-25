import { formatDay, formatTimeOfDay } from "../src/lib/darwin";
import {
  addUtcDays,
  clearOfficeClock,
  expect,
  nextMonday,
  SEED,
  setOfficeClock,
  signIn,
  signOut,
  test,
} from "./fixtures";

const FULL = "Full — request an extra spot (needs admin approval)";

// Golden path 3 (§16): extra-spot flow through the admin. Next Wednesday is 3/3 (Aisha+Chloe+Dev).
test.afterEach(() => clearOfficeClock());

test("a 4th spot needs the supervisor and then the admin", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "golden paths share one seed; run once on mobile");
  const monday = nextMonday();
  const wednesday = addUtcDays(monday, 2);

  setOfficeClock(`${monday}T09:00`);
  await signIn(page, "intern2@dgk.test");
  await page.getByRole("link", { name: "Schedule" }).click();
  await expect(page).toHaveURL(/\/clock\/schedule/);

  const fullDay = page.getByRole("button", { name: new RegExp(formatDay(wednesday)) });
  await expect(fullDay).toContainText(FULL);
  await fullDay.click();
  await page.getByRole("dialog").getByRole("button", { name: FULL }).click();

  await page.getByLabel("Reason").fill("I need the extra Wednesday to catch up before exams.");
  const preview = page.getByRole("region", { name: "Preview" });
  await expect(preview).toContainText(/extra spot|Full/i, { timeout: 15_000 });
  await expect(page.getByRole("button", { name: /^Submit$/ })).toBeEnabled();
  await page.getByRole("button", { name: /^Submit$/ }).click();
  await expect(page.getByText(/Extra day sent/i)).toBeVisible();

  await page.getByRole("link", { name: "Requests" }).click();
  const pending = page.getByRole("listitem").filter({ hasText: "Extra day" }).first();
  await expect(pending).toBeVisible();
  await expect(pending.getByText(/supervisor/i)).toBeVisible();
  await expect(pending.getByText(/admin/i)).toBeVisible();

  await signOut(page);
  await signIn(page, "sup1@dgk.test");
  await page.goto("/supervisor/approvals");
  await page
    .getByRole("button")
    .filter({ hasText: "Extra day" })
    .filter({ hasText: "Ben" })
    .filter({ hasText: /extra spot/i })
    .click();
  await page.getByRole("dialog").getByRole("button", { name: /^Approve$/ }).click();
  await expect(page.getByText(/Extra day approved/i)).toBeVisible();

  await signOut(page);
  await signIn(page, SEED.admin);
  await page.goto("/admin/requests");
  const adminRow = page.locator("li").filter({ hasText: "Ben" }).filter({ hasText: /extra spot/i });
  await expect(adminRow).toBeVisible();
  await adminRow.getByRole("button", { name: /^Approve$/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: /^Approve$/ }).click();
  await expect(page.getByText(/Extra day approved/i)).toBeVisible();

  await signOut(page);
  await signIn(page, "intern2@dgk.test");
  await page.getByRole("link", { name: "Schedule" }).click();
  const scheduled = page.getByRole("button", { name: new RegExp(formatDay(wednesday)) });
  await expect(scheduled).toContainText(new RegExp(`${formatTimeOfDay("09:00")}.*${formatTimeOfDay("17:00")}`));
  await expect(scheduled).toContainText(/Scheduled/i);

  setOfficeClock(`${wednesday}T09:00`);
  await signOut(page);
  await signIn(page, "sup1@dgk.test");
  await page.goto("/supervisor");
  await expect(page.getByRole("heading", { name: /extra spot/i })).toBeVisible();
});
