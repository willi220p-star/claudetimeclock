import { test } from "./fixtures";

// Golden path 1 (§16): an intern clocks in and out. Phase 4 exit test (must pass on mobile).
test.fixme("intern clocks in and out", async () => {
  // 1. setOfficeClock("<a seeded scheduled weekday>T08:55") for the intern chosen by the seed
  //    (consent given, yesterday's work log written, placement active).
  // 2. signIn(page, <intern>) → lands on /clock; greeting, "Week x of y" and a pace chip show.
  // 3. moveTo(page, 250) → ClockCard is blocked: "You're 250 m from the office. Move closer to clock in."
  // 4. moveTo(page, 0) → ClockCard shows "Clock in"; the office headcount reads "x/3 in today".
  // 5. Tap "Clock in" → the selfie camera opens (fake stream) → capture → submitting.
  // 6. ClockCard shows "You're in since 8:55" with the elapsed timer and a "Clock out" button.
  // 7. setOfficeClock("<same day>T16:55"), reload → tap "Clock out" → selfie → submitting.
  // 8. ClockCard shows "Day done · <counted> counted"; "This week" and "Owed" mini metrics update.
  // 9. Optional edge: setOfficeClock("<same day>T06:59:59") on a fresh day → blocked, outside the window.
});
