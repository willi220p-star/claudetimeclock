import { test } from "./fixtures";

// Golden path 4 (§16): catch-up option B submitted. Phase 5.
test.fixme("intern sends catch-up option B", async () => {
  // 1. setOfficeClock("<a seeded weekday>T09:00") for the intern the seed left with hours owed (> 0).
  // 2. signIn(page, <intern>) → /clock shows "Owed <h m>" and the "Catch up" card.
  // 3. Tap "Catch up" → the bottom sheet shows Option A (longer days) and Option B (extra days) side by side.
  // 4. Option B lists weekdays ≥ 24 h ahead, none at 3/3, with "Covers X of Y owed".
  // 5. Tap Option B's "Send requests" → toast → /clock/requests "Pending" lists one extra-day
  //    request per listed date (all or nothing, recomputed on the server).
  // 6. Optional: the supervisor's /supervisor/approvals lists the same requests.
});
