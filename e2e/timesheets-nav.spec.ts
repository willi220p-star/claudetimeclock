import { expect, SEED, signIn, test } from "./fixtures";

// 5 Oct requests: staff navigation as main tabs with sub-tabs, Timesheets with direct time edits,
// and the intern's Privacy section on the Me tab.
const shot = (name: string) => test.info().outputPath(`${name}.png`);

test("admin navigation: main tabs and sub-tabs on a phone, a grouped sidebar on desktop", async ({ page }, testInfo) => {
  await signIn(page, SEED.admin);
  if (testInfo.project.name === "mobile") {
    const tabs = page.getByRole("navigation", { name: "Admin sections" });
    await expect(tabs.getByRole("link")).toHaveText(["Home", "People", "Time", "Reports", "Settings"]);
    await tabs.getByRole("link", { name: "Time" }).click();
    await expect(page).toHaveURL(/\/admin\/roster/);
    const pages = page.getByRole("navigation", { name: "Time pages" });
    await expect(pages.getByRole("link")).toHaveText(["Roster", "Timesheets", "Requests", "Closures"]);
    await pages.getByRole("link", { name: "Timesheets" }).click();
    await expect(page.getByRole("heading", { name: "Timesheets", level: 1 })).toBeVisible();
    await page.screenshot({ path: shot("admin-time-tabs"), fullPage: true });
  } else {
    const side = page.getByRole("navigation", { name: "Admin" });
    await expect(side.getByText("People", { exact: true }).first()).toBeVisible();
    await side.getByRole("link", { name: "Timesheets" }).click();
    await expect(page.getByRole("heading", { name: "Timesheets", level: 1 })).toBeVisible();
    await page.screenshot({ path: shot("admin-sidebar") });
  }
});

test("a supervisor changes a clock-out on Timesheets", async ({ page, consoleErrors }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "one database; run once");
  await signIn(page, SEED.supervisors[0]);
  await page.getByRole("navigation", { name: "Supervisor sections" }).getByRole("link", { name: "Time" }).click();
  await page.getByRole("navigation", { name: "Time pages" }).getByRole("link", { name: "Timesheets" }).click();
  await expect(page.getByRole("heading", { name: "Timesheets", level: 1 })).toBeVisible();
  const week = page.getByRole("heading", { name: /^Week of / });
  const thisWeek = (await week.textContent())!;
  await page.getByRole("button", { name: "Previous week" }).click();
  // Read the card only once last week has loaded, or its name comes from this week's list.
  await expect(week).not.toHaveText(thisWeek);

  const card = page.getByRole("listitem").filter({ has: page.getByRole("button", { name: /clock-out at/ }) }).first();
  const name = (await card.locator("p.font-semibold").first().textContent())!.trim();
  await card.getByRole("button", { name: /clock-out at/ }).last().click();
  const sheet = page.getByRole("dialog");
  await sheet.getByLabel("Clock out").fill("17:45");
  await sheet.getByLabel("Reason").fill("Stayed late for the client call");
  await page.screenshot({ path: shot("timesheet-edit") });
  await sheet.getByRole("button", { name: "Save times" }).click();
  await expect(page.getByText(/^Times changed\./)).toBeVisible();
  const edited = page.getByRole("listitem").filter({ hasText: name }).filter({ hasText: "Edited by Priya Raman" });
  await expect(edited.first()).toBeVisible();
  await expect(edited.first().getByRole("button", { name: /clock-out at 5:45 pm/ })).toBeVisible();
  await page.screenshot({ path: shot("timesheets"), fullPage: true });
  expect(consoleErrors).toEqual([]);
});

test("an intern's Privacy section is on Me, not Home", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "phone flow");
  await signIn(page, "intern3@dgk.test");
  await expect(page.getByRole("heading", { name: /Hi Chloe/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Privacy" })).toHaveCount(0);
  await page.getByRole("link", { name: "Me" }).click();
  const privacy = page.getByRole("region", { name: "Privacy" });
  await expect(privacy.getByText("Without both, you can't clock in or out.")).toBeVisible();
  await privacy.getByRole("button", { name: "Withdraw" }).first().click();
  await expect(privacy.getByText("This stops you clocking until you allow it again.")).toBeVisible();
  await privacy.getByRole("button", { name: "Keep it" }).click();
  await expect(privacy.getByText("This stops you clocking until you allow it again.")).toHaveCount(0);
});
