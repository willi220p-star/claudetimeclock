import { expect, SEED, signIn, signOut, test } from "./fixtures";

// 12 Oct (D44): a supervisor assigns a task to two interns; one intern marks it done with a note; staff see 1 of 2.
test("tasks: assign, tick done with a note, staff see progress", async ({ page, consoleErrors }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "one database; run once");
  test.setTimeout(90_000);
  const title = `Update CRM ${Date.now() % 100000}`;

  await signIn(page, SEED.supervisors[0]);
  await page.goto("/supervisor/tasks");
  const form = page.getByRole("form", { name: "New task" });
  await form.getByLabel("Task name").fill(title);
  await form.getByLabel("Description").fill("Add this week's new leads.");
  await form.getByLabel("Priority").selectOption("high");
  const people = form.getByRole("group", { name: "Assign to" }).getByRole("checkbox");
  await people.nth(0).check();
  const chosen = (await people.nth(0).locator("xpath=..").textContent())!.trim();
  await people.nth(1).check();
  await form.getByRole("button", { name: "Add task" }).click();
  const card = page.getByRole("listitem").filter({ hasText: title }).first();
  await expect(card.getByText("0 of 2 done")).toBeVisible();

  // The first chosen intern ticks it done.
  await signOut(page);
  const login = { "Aisha Khan": "intern1@dgk.test", "Ben Nguyen": "intern2@dgk.test", "Chloe Martin": "intern3@dgk.test",
    "Dev Patel": "intern4@dgk.test", "Eli Brooks": "intern5@dgk.test" } as Record<string, string>;
  test.skip(!login[chosen], `no seed login for ${chosen}`);
  await signIn(page, login[chosen]);
  // D46: Home links to My work; the tasks live on the Tasks tab.
  await expect(page.getByRole("link", { name: /tasks? to do/ })).toBeVisible();
  await page.getByRole("navigation", { name: "Intern" }).getByRole("link", { name: "Tasks", exact: true }).click();
  await expect(page.getByRole("heading", { name: "My work", level: 1 })).toBeVisible();
  const status = page.getByRole("group", { name: `Status of ${title}` });
  await expect(status).toBeVisible();
  await expect(page.getByText("High priority").first()).toBeVisible();
  await status.getByRole("button", { name: "Done" }).click();
  await page.getByLabel("Note (optional)").fill("Added 12 leads");
  await page.getByRole("button", { name: "Mark done" }).click();
  await expect(page.getByText(/^Done \(\d+\)$/)).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("tasks-home.png"), fullPage: true });

  await signOut(page);
  await signIn(page, SEED.supervisors[0]);
  await page.goto("/supervisor/tasks");
  await expect(page.getByRole("listitem").filter({ hasText: title }).first().getByText("1 of 2 done")).toBeVisible();
  expect(consoleErrors).toEqual([]);
});
