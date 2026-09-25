# DGK Clock glossary

Use these exact words in code, UI copy and comments. The UI never says "staff" or "student".

## People
- **Person**: anyone with a login (`daymark_profiles`). Holds one or more role flags: `is_intern`, `is_supervisor`, `is_admin`.
- **Intern**: a university student on placement. The only role that clocks in.
- **Supervisor**: approves requests for their own interns, does weekly check-ins, approves the uni report. Never approves their own requests.
- **Admin**: Dilip. Can do anything and receives escalations. At least one active admin must always exist.

## Placement
- **Cohort**: a named intake group.
- **Placement**: one intern's internship: start date, planned end date, target hours, supervisor, cohort, site. Status is `active`, `extended`, `target_reached`, `completed` or `withdrawn`.
- **Target Hours**: the placement completes when counted hours reach the target (`target_minutes`).
- **Planned End Date**: the pacing reference. Extending it sets status `extended`.
- **Weekly Pattern**: the intern's usual weekdays and times, stored as versions (`daymark_pattern_versions` + `daymark_pattern_days`).
- **Schedule**: the list of **Scheduled Days** generated from the pattern. A scheduled day is `scheduled`, `moved`, `leave` or `cancelled`.
- **Site**: the office (Regus, Level 1, 1 Palmerston Circuit, Palmerston City NT 0830), with its geofence radius and capacity.
- **Closure Day**: a public holiday or office closure. Weekends are always closed.
- **Clock-in Window**: Mon–Fri 07:00–19:00 Darwin time, 19:00:00 inclusive.
- **Capacity**: Standard 3 (what interns see as "Full"), Hard 4. The 4th is an **Extra Spot** (supervisor, then admin approval). A 5th is impossible.

## Clocking
- **Punch**: one clock-in (`shift_in`) or clock-out (`shift_out`). Old `break_in`/`break_out` rows are kept and ignored.
- **Punch source**: `device` (selfie + GPS), `auto_close`, `punch_fix`, or `supervisor` (supervisor confirmation path).
- **Clock Challenge**: a single-use, 90-second server nonce with a random **Gesture** the intern shows in the selfie.
- **Shift**: a clock-in plus its clock-out.
- **Auto-closed Shift**: a shift with no clock-out by 19:00. It is closed at its own clock-in time, so it counts 0 until a punch fix is approved.
- **Unscheduled Shift**: a shift on a date with no scheduled day.
- **Flags**: fraud signals stored on a punch (`low_accuracy`, `suspicious_accuracy`, `repeat_coords`, `desktop_ua`, `new_device`). They flag; they don't block.

## Hours (integer minutes)
- **Worked**: shift time minus the **Break Deduction** (30 min when raw > 300 and no 30-minute gap).
- **Counted**: worked, capped at the scheduled length, plus approved **Overtime**.
- **Short Time**: scheduled length not worked, once the day is closed.
- **No-show**: a scheduled day that passed with no shift and no leave.
- **Owed Balance**: expected minus counted. Negative means **ahead**.
- **Grace Period**: 15 minutes. **Late** is punctuality only.
- **Pace**: green (forecast ≤ planned end), amber (1–5 days late), red (> 5 days late or no forecast).
- **Forecast Finish**: the date the target is expected to be reached at the recent attendance ratio.
- **At Risk**: any of `schedule_gap`, `owed`, `no_shows`, `forecast_late`, `low_checkin`.

## Requests
- Types: **Swap**, **Shift Change**, **Extra Day**, **Leave** (sick or personal), **Punch Fix**, **Overtime**, **Pattern Change**.
- **Escalation**: a request pending with a supervisor for more than 72 h goes to the admin. Nothing is ever auto-approved.
- **Catch-up Plan**: option A (longer days) or B (extra days) offered when hours are owed.

## Records and reports
- **Work Log**: 10–500 characters on what the intern did, required before the next clock-in.
- **Check-in**: the supervisor's weekly 1–5 ratings (reliability, quality, communication) plus a comment.
- **Monday Summary**: last week per intern, for supervisors.
- **Uni Report**: the supervisor-approved PDF of weekly counted hours with a document ID.
- **Certificate**: landscape PDF after completion.
- **Exit Feedback**: five questions the intern answers after the placement ends.

## Privacy
- **Collection Notice**: the versioned text shown before any camera or GPS use. Its SHA-256 is stored with each consent record.
- **Consent Record**: an append-only row per purpose (`collection_notice`, `location`, `selfie`, `medical_certificate`, `privacy_policy`) and decision (`granted`, `refused`, `withdrawn`, `acknowledged`).
- **Supervisor Confirmation**: the clocking path for an intern who refuses location or selfie consent. Hours count only after a supervisor confirms.
- **Verification Method**: how an hours entry was verified: `gps_selfie`, `supervisor`, or `punch_fix`.
- **Retention Period**: 30 days after the placement ends, then everything about that intern is permanently deleted. Medical certificate files go 7 days after the leave decision.
