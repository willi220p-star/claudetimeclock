import { test } from "./fixtures";

// Golden path 2 (§16): intern submits a swap → supervisor approves → the schedule updates. Phase 5.
test.fixme("intern swaps a day and the supervisor approves it", async () => {
  // 1. setOfficeClock("<a seeded Monday>T09:00") so the day to move is ≥ 24 h away (C4).
  // 2. signIn(page, <intern>) → /clock/schedule → tap a scheduled day → "Swap".
  // 3. Pick a new weekday under 3/3, keep the times, enter a reason.
  // 4. The Preview panel shows the server verdict, e.g. "Tue 14 Oct becomes 9:00–17:00 · office 2/3 → 3/3".
  // 5. Submit → toast → /clock/requests "Pending" lists the swap with the timeline at "supervisor".
  // 6. Sign out; signIn(page, <the intern's supervisor>) → /supervisor/approvals lists it, oldest first.
  // 7. Open it → the Approve sheet shows the preview and capacity after approval → "Approve".
  // 8. Sign out; signIn(page, <intern>) → /clock/schedule: the old day shows "moved",
  //    the new date shows the scheduled times; the request sits under "Decided" as approved.
});
