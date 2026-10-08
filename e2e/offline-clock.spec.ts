import { expect, signIn, signOut, test } from "./fixtures";

// D35 (Dilip, 8 Oct): with no signal an intern still clocks; the phone keeps the clock (its own time,
// GPS, a selfie with a phone-picked gesture) and sends it when back online; the supervisor confirms it.
// Real time on purpose: an offline clock carries the phone's clock, which the frozen office clock can't match.
test("an intern clocks in with no signal; it sends when back online and the supervisor confirms it", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "the clock is a phone flow");
  test.setTimeout(120_000);

  await signIn(page, "intern4@dgk.test");
  await expect(page).toHaveURL(/\/clock/);
  await page.getByRole("radio", { name: /^Full day/ }).click();
  await expect(page.getByRole("radio", { name: /^Full day/ })).toHaveAttribute("aria-checked", "true");

  await page.context().setOffline(true);
  await expect(page.getByText(/You're offline — you can still clock/)).toBeVisible();
  await page.getByRole("button", { name: /^clock in$/i }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByText(/No signal\. This clock is saved on your phone/)).toBeVisible();
  await sheet.getByRole("button", { name: /^clock in$/i }).click();
  await expect(sheet.getByText("Show this in your photo")).toBeVisible();
  await sheet.getByRole("button", { name: /take photo/i }).click();
  await sheet.getByRole("button", { name: /use photo/i }).click();
  await expect(page.getByText(/^Saved on this phone at /)).toBeVisible();
  await expect(page.getByText("1 clock is waiting to send from this phone.", { exact: false })).toBeVisible();
  await expect(page.getByText(/Clocked in since|clocked in/i).first()).toBeVisible();

  await page.context().setOffline(false);
  await expect(page.getByText("Your offline clock was sent. Your supervisor confirms it.")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/waiting to send from this phone/)).toHaveCount(0);
  await signOut(page);

  await signIn(page, "sup2@dgk.test");
  await page.goto("/supervisor/approvals");
  const row = page.getByRole("button").filter({ hasText: "Dev Patel" }).filter({ hasText: /Typed-in time/ });
  await expect(row).toBeVisible();
  await row.click();
  const approve = page.getByRole("dialog");
  await expect(approve.getByText(/^Offline: clocked in offline at .* \(phone time\)/)).toBeVisible();
  await expect(approve.getByRole("img", { name: "Selfie sent with this clock" })).toBeVisible();
  await approve.getByRole("button", { name: /^Approve$/ }).click();
  await expect(page.getByText(/approved\./i).first()).toBeVisible();
});
