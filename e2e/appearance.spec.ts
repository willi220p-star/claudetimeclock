import { expect, signIn, test } from "./fixtures";

// 9 Oct (D38): dark mode and bigger text, kept on this phone.
test("an intern picks dark mode and larger text; it sticks after a reload", async ({ page, consoleErrors }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "phone flow");
  await signIn(page, "intern3@dgk.test");
  await page.goto("/clock/me");
  const card = page.getByRole("region", { name: "Appearance" });
  await card.getByText("Dark", { exact: true }).click();
  await card.getByText("Larger", { exact: true }).click();
  const html = page.locator("html");
  await expect(html).toHaveClass(/dark/);
  await expect(html).toHaveAttribute("data-text", "larger");
  await page.screenshot({ path: test.info().outputPath("dark-me.png"), fullPage: true });
  await page.reload();
  await expect(html).toHaveClass(/dark/);
  await expect(html).toHaveAttribute("data-text", "larger");
  await page.goto("/clock");
  await page.screenshot({ path: test.info().outputPath("dark-home.png"), fullPage: true });
  // Put it back so later specs see the default.
  await page.goto("/clock/me");
  await page.getByRole("region", { name: "Appearance" }).getByText("Match phone", { exact: true }).click();
  await page.getByRole("region", { name: "Appearance" }).getByText("Normal", { exact: true }).click();
  await expect(html).not.toHaveClass(/dark/);
  expect(consoleErrors).toEqual([]);
});
