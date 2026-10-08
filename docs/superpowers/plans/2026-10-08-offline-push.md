# Plan: installable app + offline clock-in (PR A), push reminders (PR B)

Design: `docs/superpowers/specs/2026-10-08-offline-push-design.md`.

## PR A
- [x] A.1 pgTAP 130 + migration `20261009010000_offline_clock.sql`: `offline_id`, `request_punch_confirmation` + `save_day_kind` (shared with `report_missed_time` and `choose_day_kind`), `submit_offline_punch`, notice v1.3.
- [x] A.2 `src/lib/offline-queue.ts` (IndexedDB + pure `applyQueue`, gestures) with Vitest.
- [x] A.3 `src/lib/offline-sync.ts` and the clock sheet's offline mode; Home banner and cached status.
- [x] A.4 Approve sheet selfie + gesture; "Offline · waiting" chips.
- [x] A.5 Service worker (hand-written, built over `out/`; Serwist skipped), registration, update toast; install card on Me.
- [x] A.6 e2e `offline-clock.spec.ts`; served-`out/` service worker check.
- [x] A.7 Docs (D34, D35, BUILD-LOG, SECURITY-REVIEW addendum); gates; preview migration; PR, merge, deploy.

## PR B
- [x] B.1 pgTAP 140 + migration `20261010010000_push_reminders.sql`: subscriptions, outbox + quiet hours, `job_reminders`, cron, `call_send_push`.
- [x] B.2 Edge Function `send-push` (web-push) + helper tests (Vitest; no Deno here).
- [x] B.3 Service worker push + click handlers; "Reminders on this phone" on Me and Notifications, with Vitest.
- [x] B.4 VAPID keys (public in Pages env, private as Edge secret on preview); docs (D36); gates; preview deploy; PR, merge, deploy; real-phone check.
