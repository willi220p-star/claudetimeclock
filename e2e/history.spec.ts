import { expect, openMe, SEED, signIn, test } from "./fixtures";

// D46: Schedule → History lists every day since the placement started. Tapping a recent day opens
// a punch fix pre-filled with that day's times; once sent, Requests has it and the day reads
// "Fix requested" and can't be tapped again. Aisha (intern1) has ten weeks of seeded clocks.
test("shift history: tap a day, send a fix, see it in Requests", async ({ page, consoleErrors }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "one database; run once");
  test.setTimeout(90_000);

  await signIn(page, SEED.interns[0]);
  await page.getByRole("navigation", { name: "Intern" }).getByRole("link", { name: "Schedule", exact: true }).click();
  const segments = page.getByRole("navigation", { name: "Schedule pages" });
  await expect(segments.getByRole("link", { name: "Roster" })).toHaveAttribute("aria-current", "page");
  await segments.getByRole("link", { name: "History" }).click();
  await expect(page).toHaveURL(/\/clock\/schedule\/history/);
  await expect(page.getByRole("heading", { name: "Shift history", level: 1 })).toBeVisible();
  await expect(page.getByText(/counted$/).first()).toBeVisible();

  // The newest day with both a clock-in and a clock-out that can still be fixed.
  const day = page.getByRole("button", { name: /Ask for a fix/ }).filter({ hasText: /\d:\d\d [ap]m – \d/ }).first();
  await day.click();
  const dialog = page.getByRole("dialog");
  const title = (await dialog.getByRole("heading").first().textContent())!.replace(/^Fix /, "").trim();

  // Start five minutes later than recorded: a small, valid correction of the clock-in.
  const clockIn = dialog.getByLabel("Clock in");
  const [hour, minute] = (await clockIn.inputValue()).split(":").map(Number);
  const later = hour * 60 + minute + 5;
  await clockIn.fill(`${String(Math.floor(later / 60)).padStart(2, "0")}:${String(later % 60).padStart(2, "0")}`);
  await dialog.getByRole("button", { name: "Wrong time" }).click();
  await expect(dialog.getByRole("button", { name: "Wrong time" })).toHaveAttribute("aria-pressed", "true");
  await expect(dialog.getByLabel("Reason")).toHaveValue(/wrong/i);

  const submit = dialog.getByRole("button", { name: /^Submit$/ });
  await expect(submit).toBeEnabled({ timeout: 15_000 });
  await submit.click();
  await expect(page.getByText(/Punch fix sent/i)).toBeVisible();

  await expect(page).toHaveURL(/\/clock\/requests/);
  await openMe(page, "Requests");
  const nav = page.getByRole("navigation", { name: "Me pages" });
  await expect(nav.getByRole("link", { name: /^Requests/ })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("navigation", { name: "Intern" }).getByRole("link", { name: "Me", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  const pending = page.getByRole("listitem").filter({ hasText: "Punch fix" }).filter({ hasText: title }).first();
  await expect(pending).toBeVisible();

  // Back in History the day says so, and a second fix can't be started from it.
  await page.goto("/clock/schedule/history");
  const fixed = page.getByRole("listitem").filter({ hasText: "Fix requested" }).first();
  await expect(fixed).toBeVisible();
  await expect(fixed.getByRole("button")).toHaveCount(0);
  expect(consoleErrors).toEqual([]);
});
