# Weekly sign-off, timesheet export and pay rates: contract (D43)

This is the shared interface for the three parallel workers. The database must match it exactly. The UI codes against it. The types are already hand-added in `src/lib/database.types.ts`, and the database worker regenerates them at the end.

## Dilip's answers (12 Oct)

- A week runs Monday to Sunday. Sign-off is due Tuesday at 5 pm. Supervisors get reminders on Monday and Tuesday mornings.
- A week can't be signed while it has open items:
  - a shift with no clock-out on a past date;
  - a pending request touching the week;
  - an unconfirmed typed-in or offline time.
- A supervisor (or an admin) can change a signed week without asking permission. Any change to a counted day reopens the week, keeps the reason, notifies the signer and is audited.
- The export is a plain CSV, with no payroll format yet.
- Paid placements record an hourly rate only. Payroll does tax and super.

## Database (migration `20261017010000_signoff.sql`, pgTAP `200_signoff.sql`)

**Placement pay columns:**
- `daymark_placements.paid boolean not null default false`
- `daymark_placements.hourly_rate numeric(8,2)`, with the check `not paid or hourly_rate > 0`.

**Table `daymark_week_signoffs`:**
- Columns: `id uuid pk`, `placement_id uuid` (references placements, on delete cascade), `week_start date` (always a Monday), `signed_by uuid` (references profiles, on delete set null), `signed_at timestamptz`, `counted_minutes integer` (the week's counted total at signing), `reopened_at timestamptz`, `reopened_reason text`.
- One live sign-off per week: a unique index on `(placement_id, week_start) where reopened_at is null`.
- Reopening sets `reopened_at` and `reopened_reason`. Rows are never deleted, so the history stays.
- RLS: no direct grants. Access goes through the functions below.

**RPCs:** each is a private SECURITY DEFINER function plus a public invoker wrapper, with execute granted to authenticated and revoked from anon.

| Function | Who | Returns / behaviour |
|---|---|---|
| `set_placement_pay(placement uuid, paid boolean, hourly_rate numeric default null)` | admin | void. 22023 "Set an hourly rate above 0." when paid has no rate. Audited. |
| `week_open_items(placement uuid, week_start date)` | the placement's supervisor or an admin (42501 otherwise) | `table(kind text, work_date date, label text)`, ordered by date. Kinds: `no_clock_out`, `pending_request`, `unconfirmed_time`. Labels are plain English, e.g. "No clock-out on Tue 14 Oct". |
| `sign_week(placement uuid, week_start date)` | the placement's supervisor (`supervisor_id`) or an admin; 42501 otherwise, interns included | jsonb `{signed_at, counted_minutes}`. See the sign-week rules below. |
| `week_signoffs(from_date date, to_date date)` | supervisor: own placements; admin: all | `table(placement_id, week_start, signed_by_name, signed_at, counted_minutes)`. Live sign-offs only (`reopened_at is null`) with `week_start` in the range. |
| `signoff_export(from_date date, to_date date)` | admin only (42501) | `table(intern_name, placement_id, week_start, work_date, counted_minutes, break_minutes, paid, hourly_rate, amount)`. One row per `daymark_day_results` day inside a live signed week in the range. `amount = round(counted_minutes / 60.0 * hourly_rate, 2)` when paid, else null. Ordered by intern name, then date. |

**`sign_week` rules:**
- 22023 when `week_start` isn't a Monday.
- 22023 "You can sign a week once it has ended." when `private.darwin_today() < week_start + 7`.
- P0001 "Fix the open items first." with hint `open_items` when `week_open_items` returns any rows.
- P0001 "Already signed." when a live sign-off exists.
- `counted_minutes` is the sum of `daymark_day_results.counted` for that placement and week.
- Audited (`sign_week`).

**Reopening:** an AFTER INSERT/UPDATE/DELETE trigger on `daymark_day_results` fires when a row's `counted` or `break` changes, or a row is inserted or deleted, on a date inside a live signed week. The trigger:
- sets `reopened_at = clock_now()`;
- sets `reopened_reason = 'Times changed on ' || fmt_day(work_date)`;
- notifies the signer with kind `times`, title "A signed week reopened" and a body naming the intern and the week;
- audits `reopen_week`.

A recompute that changes nothing must not reopen.

**Reminders:**
- `private.job_signoff_reminders()` notifies each active supervisor, with kind `signoff`, who has active, extended or target-reached placements whose last full week (Monday of last week) has a counted or scheduled day and no live sign-off.
- When: Monday and Tuesday, 09:00–12:00 Darwin, once a day via `daymark_reminders_sent` (add kind `signoff` to its check).
- Title "Weeks to sign", body "3 weeks to sign by Tuesday 5 pm.", link `/supervisor/timesheets`.
- Add `signoff` to `push_kind_options`, the settings default and the existing settings row.
- Redefine `private.job_reminders()` as day + evening + digest + signoff.

**Tests (pgTAP 200), at least:**
- sign a clean week;
- refused while open, and each of the three kinds is listed;
- refused before the week ends and on a non-Monday;
- intern refused, other supervisor refused, admin allowed;
- a counted change reopens it, notifies the signer and keeps the old row;
- a no-op recompute doesn't reopen;
- the export has only signed days, and the amount equals rate times hours;
- `set_placement_pay` validates;
- the reminder fires once on Monday morning.

## UI

**Worker B: export and pay**
- `src/lib/timesheet-csv.ts`: `exportCsv(rows)`, a pure function returning CSV text, with Vitest.
  - Header: `Intern,Week starting,Date,Hours,Break (min),Paid,Hourly rate,Amount`.
  - Hours are decimals with 2 places.
  - RFC 4180 quoting, `\r\n` line endings, and a totals row per intern.
- An **Export CSV** button on the admin Timesheets page with a from/to date range (default: the last full fortnight). It calls `signoff_export` and downloads with a Blob, as `dgk-hours-<from>-to-<to>.csv`.
- Paid and hourly rate fields on the admin placement screen (`src/app/admin/placement/placement-screen.tsx`), saved with `set_placement_pay`. Show "Paid · $25.00/h" or "Unpaid" in the summary.

**Worker C: sign-off on Timesheets**
- In `src/components/timesheets.tsx`, for each intern in the week view:
  - **Signed:** a "Signed by Priya, Tue 4:10 pm" chip (from `week_signoffs`).
  - **Unsigned, week ended:** a **Sign week** button. It first calls `week_open_items`. If there are items, it lists them with their labels and the button stays disabled. If not, it confirms, calls `sign_week` and reloads.
  - **Unsigned, week not ended:** no button.
- Reuse the existing week navigation. Supervisors and admins both see it.
- Settings → Notifications gets a "Weeks to sign" checkbox (kind `signoff`, staff group).
