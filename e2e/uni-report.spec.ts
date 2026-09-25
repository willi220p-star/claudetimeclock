import { test } from "./fixtures";

// Golden path 5 (§16, adapted by D13): the supervisor approves the uni report. There is no PDF,
// so nothing is downloaded. Phase 8.
test.fixme("supervisor approves the uni report", async () => {
  // 1. The seed has an intern whose hours are final (target reached or completed).
  // 2. signIn(page, <that intern's supervisor>) → /supervisor/intern?id=<placement> → "Approve uni report".
  // 3. Confirm → the page shows the report as approved with the supervisor's name and the Darwin date.
  // 4. signIn(page, <intern>) → /clock/me shows the uni report as approved (no download, D13).
  // 5. Optional: signIn(page, SEED.supervisors[1]) (not their supervisor) cannot approve it (RLS).
});
