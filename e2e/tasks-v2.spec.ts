import type { Page } from "@playwright/test";
import { expect, SEED, signIn, signOut, test } from "./fixtures";

// 13 Oct (D48): assign with a reviewer and subtasks → tick → send for review → needs changes → fix → approve → done.
test("tasks v2: review loop with subtasks and comments", async ({ page, consoleErrors }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "one database; run once");
  test.setTimeout(120_000);
  const title = `Client brief ${Date.now() % 100000}`;
  const intern = SEED.interns[0]; // Aisha Khan, supervised by sup1.

  // The supervisor assigns it to Aisha; the reviewer defaults to them (the creator).
  await signIn(page, SEED.supervisors[0]);
  await page.goto("/supervisor/tasks");
  const form = page.getByRole("form", { name: "New task" });
  await form.getByLabel("Task name").fill(title);
  await form.getByRole("group", { name: "Assign to" }).getByLabel("Aisha Khan").check();
  await expect(form.getByLabel("Reviewer").locator("option:checked")).toHaveText("Me");
  await form.getByLabel("Estimate hours").fill("1");
  await form.getByLabel("Estimate minutes").fill("30");
  await form.getByRole("button", { name: "Add subtasks" }).click();
  await form.getByLabel("Subtask 1").fill("Read the notes");
  await form.getByRole("button", { name: "Add another" }).click();
  await form.getByLabel("Subtask 2").fill("Write the brief");
  await form.getByRole("button", { name: "Add task" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: title }).first().getByText("0 of 1 done")).toBeVisible();

  // Aisha ticks both subtasks and sends it for review.
  await signOut(page);
  await signIn(page, intern);
  await page.goto("/clock/tasks");
  let sheet = await openTask(page, title);
  await expect(sheet.getByText("1 h 30 m")).toBeVisible();
  const send = sheet.getByRole("button", { name: "Send for review" });
  await expect(send).toBeDisabled();
  await expect(sheet.getByText("Tick all 2 subtasks to send for review.")).toBeVisible();
  for (const name of ["Read the notes", "Write the brief"]) {
    await sheet.getByRole("checkbox", { name }).check();
    await expect(sheet.getByRole("checkbox", { name })).toBeChecked();
  }
  await expect(send).toBeEnabled();
  await send.click();
  await expect(sheet.getByText("Waiting for", { exact: false })).toBeVisible();

  // The supervisor asks for changes; a comment is required.
  await signOut(page);
  await signIn(page, SEED.supervisors[0]);
  await page.goto("/supervisor/tasks");
  sheet = await openTask(page, `${title} · Aisha Khan`);
  await sheet.getByRole("button", { name: "Needs changes" }).click();
  await expect(sheet.getByText("Write what needs changing", { exact: false })).toBeVisible();
  await sheet.getByLabel("Write a comment").fill("Add the client's logo, then send it again.");
  await sheet.getByRole("button", { name: "Needs changes" }).click();
  await expect(sheet.getByText("asked for changes", { exact: false })).toBeVisible();

  // Aisha sees the comment and sends it again.
  await signOut(page);
  await signIn(page, intern);
  await page.goto("/clock/tasks");
  sheet = await openTask(page, title);
  await expect(sheet.getByText("Add the client's logo, then send it again.")).toBeVisible();
  await sheet.getByRole("button", { name: "Send for review" }).click();
  await expect(sheet.getByText("Waiting for", { exact: false })).toBeVisible();

  // The supervisor approves; the copy is Done.
  await signOut(page);
  await signIn(page, SEED.supervisors[0]);
  await page.goto("/supervisor/tasks");
  sheet = await openTask(page, `${title} · Aisha Khan`);
  await sheet.getByRole("button", { name: "Approve" }).click();
  await expect(sheet.getByText("Done", { exact: true }).first()).toBeVisible();
  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: title }).first().getByText("1 of 1 done")).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("tasks-v2-done.png"), fullPage: true });
  expect(consoleErrors).toEqual([]);
});

async function openTask(page: Page, name: string) {
  await page.getByRole("button", { name: new RegExp(name) }).first().click();
  const sheet = page.getByRole("dialog", { name: name.split(" · ")[0] });
  await expect(sheet).toBeVisible();
  return sheet;
}
