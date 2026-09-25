import { test } from "./fixtures";

// Golden path 3 (§16): extra-spot flow through the admin. Phase 5.
test.fixme("a 4th spot needs the supervisor and then the admin", async () => {
  // 1. setOfficeClock("<a seeded weekday>T09:00"); the seed has a date ≥ 24 h ahead already at 3/3.
  // 2. signIn(page, <intern not on that date>) → /clock/schedule → the full date shows
  //    "Full — request an extra spot (needs admin approval)".
  // 3. Request an extra day on that date with a reason → the preview flags the extra spot → Submit.
  //    The timeline shows submitted → supervisor → admin → outcome.
  // 4. signIn(page, <supervisor>) → /supervisor/approvals → Approve → status moves to pending admin.
  // 5. signIn(page, SEED.admin) → /admin/requests → the request shows the extra-spot marker → Approve.
  // 6. The intern's schedule shows the new day; the supervisor's board for that date reads
  //    "3/3 today (+1 extra spot)".
  // 7. Optional edge: a 5th request on the same date is rejected with the friendly capacity message.
});
