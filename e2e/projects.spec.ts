import { expect, SEED, signIn, signOut, test } from "./fixtures";

// 13 Oct (D49): an intern adds a project → the supervisor approves → the intern files a task under it → done (no
// reviewer) → the project shows "1 of 1 tasks done" and the activity shows the task.
test("projects: add, approve, file a task, finish it, see progress and activity", async ({ page, consoleErrors }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "one database; run once");
  test.setTimeout(120_000);
  const stamp = Date.now() % 100000;
  const name = `Harbour Cafe site ${stamp}`;
  const title = `Menu photos ${stamp}`;
  const intern = SEED.interns[0]; // Aisha Khan, supervised by sup1.

  // Aisha adds a project; it waits for approval.
  await signIn(page, intern);
  await page.getByRole("navigation", { name: "Intern" }).getByRole("link", { name: "Projects", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Projects", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Project", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "New project" });
  await sheet.getByLabel("Project name").fill(name);
  await sheet.getByLabel("Client name").fill("Harbour Cafe");
  await sheet.getByLabel("Status").selectOption("active");
  await sheet.getByLabel("Link 1", { exact: true }).fill("https://example.com/brief");
  await sheet.getByRole("button", { name: "Add project" }).click();
  await page.waitForURL(/\/clock\/projects\/view\?id=/);
  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
  await expect(page.getByText("Waiting for approval").first()).toBeVisible();

  // The supervisor approves it from "Approve projects".
  await signOut(page);
  await signIn(page, SEED.supervisors[0]);
  await page.goto("/supervisor/projects");
  const approvals = page.getByRole("region", { name: "Approve projects" });
  await approvals.getByRole("button", { name: `Approve ${name}` }).click();
  await expect(approvals.getByRole("button", { name: `Approve ${name}` })).toHaveCount(0);

  // Aisha files a task under it from the project's Tasks segment and marks it done (no reviewer).
  await signOut(page);
  await signIn(page, intern);
  await page.goto("/clock/projects");
  await page.getByRole("link", { name: new RegExp(name) }).click();
  await page.getByRole("navigation", { name: "Project sections" }).getByRole("link", { name: /^Tasks/ }).click();
  await page.getByRole("button", { name: "Task", exact: true }).click();
  const form = page.getByRole("dialog", { name: "New task" });
  await expect(form.getByRole("combobox", { name: "Project" })).toHaveValue(name);
  await form.getByLabel("Task name").fill(title);
  await form.getByRole("button", { name: "Add task" }).click();
  await expect(form).toBeHidden();
  await page.getByRole("button", { name: new RegExp(title) }).click();
  const task = page.getByRole("dialog", { name: title });
  await task.getByRole("button", { name: "Mark done" }).click();
  await task.getByRole("button", { name: "Mark done" }).click();
  await expect(task.getByRole("button", { name: "Reopen" })).toBeVisible();
  await task.getByRole("button", { name: "Close" }).click();

  // Overview shows the progress; Activity shows the task.
  await page.getByRole("navigation", { name: "Project sections" }).getByRole("link", { name: "Overview" }).click();
  await expect(page.getByText("1 of 1 tasks done")).toBeVisible();
  await page.getByRole("navigation", { name: "Project sections" }).getByRole("link", { name: "Activity" }).click();
  await expect(page.getByText(new RegExp(`finished ${title}`))).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("projects-activity.png"), fullPage: true });
  expect(consoleErrors).toEqual([]);
});
