# Plan: installable app + offline clock-in (PR A), push reminders (PR B)

Design: `docs/superpowers/specs/2026-10-08-offline-push-design.md`.

## PR A
- [ ] A.1 pgTAP 130 + migration `20261009010000_offline_clock.sql`: `offline_id`, `file_unverified_punch` (shared with `report_missed_time`), `submit_offline_punch`, notice v1.3.
- [ ] A.2 `src/lib/offline-queue.ts` (IndexedDB + pure `applyQueue`, gestures) with Vitest.
- [ ] A.3 `src/lib/offline-sync.ts` and the clock sheet's offline mode; Home banner and cached status.
- [ ] A.4 Approve sheet selfie + gesture; "Offline · waiting" chips.
- [ ] A.5 Service worker (Serwist inject-manifest over `out/`), registration, update toast; install card on Me.
- [ ] A.6 e2e `offline-clock.spec.ts`; served-`out/` service worker check.
- [ ] A.7 Docs (D34, D35, BUILD-LOG, SECURITY-REVIEW addendum); gates; preview migration; PR, merge, deploy.

## PR B
- [ ] B.1 pgTAP 140 + migration `20261010010000_push_reminders.sql`: subscriptions, outbox + quiet hours, `job_reminders`, cron, `call_send_push`.
- [ ] B.2 Edge Function `send-push` (web-push) + Deno test.
- [ ] B.3 Service worker push + click handlers; Me / staff "Reminders on this phone" toggle with Vitest.
- [ ] B.4 VAPID keys (public in Pages env, private as Edge secret on preview); docs (D36); gates; preview deploy; PR, merge, deploy; real-phone check.
