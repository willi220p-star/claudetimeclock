import { expect, SEED, signIn, signOut, test } from "./fixtures";

// 12 Oct (D42): the admin adds an office tablet; an intern sets a PIN; the tablet clocks them in with a selfie.
test("kiosk: name, PIN, day type, selfie", async ({ page, consoleErrors }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "one database; run once");
  test.setTimeout(90_000);
  const email = `kiosk${Date.now() % 100000}@dgk.test`;
  const password = "Kiosk-password-1234";

  await signIn(page, SEED.admin);
  await page.goto("/admin/people");
  await page.getByText("Add a kiosk (office tablet)").click();
  await page.getByLabel("Sign-in email for the tablet").fill(email);
  await page.getByLabel(/^Tablet password/).fill(password);
  await page.getByRole("button", { name: "Add kiosk" }).click();
  await expect(page.getByText(/Kiosk added/)).toBeVisible();

  await signOut(page);
  await signIn(page, "intern3@dgk.test");
  await page.goto("/clock/me");
  await page.getByLabel("New PIN").fill("2468");
  await page.getByRole("button", { name: "Save PIN" }).click();
  await expect(page.getByText(/Kiosk PIN saved/)).toBeVisible();

  await signOut(page);
  await signIn(page, email, password);
  await expect(page).toHaveURL(/\/kiosk/);
  await page.getByRole("button", { name: /Chloe/ }).click();
  for (const digit of "1111") await page.getByRole("button", { name: digit, exact: true }).click();
  await page.getByRole("button", { name: "Clock in" }).click();
  await expect(page.getByText(/That PIN didn't work/)).toBeVisible();
  for (const digit of "2468") await page.getByRole("button", { name: digit, exact: true }).click();
  await page.getByRole("button", { name: "Clock in" }).click();
  await page.getByRole("button", { name: "Full day" }).click();
  await expect(page.getByRole("button", { name: "Take photo" })).toBeEnabled({ timeout: 15000 });
  await page.screenshot({ path: test.info().outputPath("kiosk-selfie.png") });
  await page.getByRole("button", { name: "Take photo" }).click();
  await expect(page.getByText("Done, Chloe")).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("kiosk-done.png") });
  // The first Clock in is refused with "pick the day type" (a 400) before the kiosk asks: expected.
  expect(consoleErrors.filter((e) => !e.includes("status of 400"))).toEqual([]);
});
