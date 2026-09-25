# DGK Clock program design (placement system)

`docs/BUILD-PROMPT.md` is the binding spec: rules R5.x, algorithms §8, requests §9, data model §10, UX §11, KPIs §12. This file records only what **adapts** it for this repository, and the security overlay from `docs/SECURITY-REVIEW.md`. Where the two differ, this file wins because Dilip chose these answers on 2026-09-25.

## Repository and delivery
- Code lives in `willi220p-star/claudetimeclock`, imported from `presence-tracker@b7f9ab5`. GitHub Pages `basePath` is `/claudetimeclock`.
- Branch `claude/quirky-lovelace-ktg6f8` (the session's designated branch) replaces `feat/placement-system`. Tags `phase-N-done`. Draft PR to `main` at the end.
- The DGK spec bundle (`DGK-Clock_Superpowers_v2.zip`) was not supplied. `CONTEXT.md`, the ADRs and every phase spec and plan were written from the build prompt.
- Supabase CLI is installed globally (`npm i -g supabase`), not as a project dependency, so §5.5 stays intact.

## Decisions that change build-prompt behaviour
| # | Topic | Build prompt | Adopted |
|---|---|---|---|
| D3 | Auto-close (R5.5.1) | Clock-out at scheduled end, hours count | Clock-out = clock-in (0 min), flagged `auto_closed`; counts only after a punch fix is approved |
| D4 | Office code / kiosk | — | Not built |
| D5 | MFA (aal2) | — | Not now; open question and release checklist item |
| D6 | Consent | — | Full consent pack: collection notice v1.0, append-only consent records, `has_consent` gate, supervisor-confirmation path, `verification_method` on reports |
| D7 | Clock window end | 19:00:00 inclusive | Kept (review said 18:59) |
| D8 | Offboarding | Read-only for 30 days | Kept; Auth user removed by `retention-purge` |
| D9 | Hosting | GitHub Pages | Kept with meta CSP; host move, CAPTCHA, Sydney region, backups, Pro plan go to the release checklist |
| D10 | Seed data in migrations | Site and closure days in `seed.sql` | The Regus site and NT closure days 2026–2027 are real data, so they go in a migration. `seed.sql` holds only test people and history |
| D11 | Passwords | 8–72 characters | 12–72 characters (review §4.1), matching `minimum_password_length = 12` |
| D12 | Deleting people | Admin could delete a login | Removed. Admin deactivates; deletion happens only through the retention purge |

## Security overlay (review §5, mapped to daymark names)
- Clocking goes through `public.start_clock(event_type)` → a `daymark_clock_challenges` row (90 s, single use, random gesture) → selfie uploaded to `daymark-photos/<intern>/<challenge>.jpg` → `public.clock_punch(...)`. The function checks the challenge, that the object exists, is owned by the caller and was created within 3 minutes of issue, and that `accuracy_m ≤ 150`. It stamps `occurred_at := private.clock_now()` and keeps the client time only as `client_reported_at`.
- One punch per intern per 60 s.
- Flags: `suspicious_accuracy` (≤ 3 m), `low_accuracy` (> 50 m), `repeat_coords` (same 5-decimal point on an earlier day), `desktop_ua`, `new_device`.
- No third-party geocoding. `place_name` comes from the site row.
- Location is read once, on the tap, never with `watchPosition`.
- Segregation of duties: nobody decides their own request. An intern's supervisor can't be themselves.
- Punch fix: a reason of at least 20 characters and at most 2 per rolling fortnight (admin override, audited).
- The audit log is append-only: no API write grants, and a trigger raises on update or delete.
- Signed URLs last 60 s. No `dangerouslySetInnerHTML`. CSV cells starting with `= + - @` are escaped. PDFs are built from data.
- Client idle sign-out after 30 min, and a "Sign out everywhere" option.
- Interns see a fortnight hours summary (R5.7.2 fortnights).
- Uni report entries show the verification method and approver.

## Phase map
As in build prompt §19, plus:
- **Phase 1:** challenges, consent tables and the consent screen, because clock-in is gated on consent from Phase 1.
- **Phase 5:** supervisor confirmation and punch-fix limits.
- **Phase 6:** flagged-events view.
- **Phase 8:** 7-day certificate purge.
