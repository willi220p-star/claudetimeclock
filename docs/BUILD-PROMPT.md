# DGK Clock — Master Build Prompt (one paste, whole app)

> **For Dilip — read this box, then paste everything below the line into Claude Code.**
> 1. Open the `presence-tracker` repo in Claude Code on your computer (Docker Desktop running, Supabase CLI installed, `gh` logged in).
> 2. Copy `CONTEXT.md`, `docs/adr/`, and `docs/superpowers/` from `DGK-Clock_Superpowers_v2.zip` into the repo root (same paths).
> 3. Save this file into the repo as `docs/BUILD-PROMPT.md`.
> 4. Model: **Claude Opus 5.5** (`/model` → Opus). Start in **plan mode** (Shift+Tab) for Step 0 only, approve the plan, then switch to auto-accept edits.
> 5. Paste: `Read docs/BUILD-PROMPT.md in full and execute it.`
> 6. If the session runs out of context or you close it, open a new one and paste the same line. It resumes from `docs/progress/BUILD-LOG.md`.
> 7. It will **stop and ask you** before anything touches the live Supabase project, GitHub Pages or `main`.
> 8. Section 23 lists the assumptions I made for you. Change any of them before you paste.

---

<prompt>

# 0. Who you are and what you're doing

You are a principal full-stack engineer and product designer, and you're working alone on a production codebase. You will turn **DGK Clock** (repo `willi220p-star/presence-tracker`), a basic intern time clock, into a complete **intern placement system** for DGK Business Consultancy in Darwin, Australia.

Your job is the **whole app**, built in the 8 phases in §19. You run them one after another in this single session. Each phase is test-first, verified with command output, and committed. Stop only at the **STOP conditions** in §1.3.

Quality bar:
- A university must trust the hours report.
- An intern must be able to clock in on a phone in under 10 seconds.
- A supervisor must clear their approvals in under a minute.
- Dilip, the admin, must see from one screen whether every placement is on pace.

---

# 1. Operating mode (read this first, and re-read it after every compaction)

## 1.1 Reading order before you write any code
1. `AGENTS.md`. It says *"This is NOT the Next.js you know… read `node_modules/next/dist/docs/`."* Obey it. Check the bundled docs for **every** Next API you use (App Router, static export, `next/font`, metadata, `useSearchParams`, images).
2. `CONTEXT.md` (glossary). Use these exact words in code, UI and comments.
3. `docs/adr/0001`–`0003`.
4. `docs/superpowers/specs/2026-09-25-dgk-clock-program-design.md`. This is the binding spec. Where this prompt adds detail, **this prompt wins**. Where the two conflict, stop and ask (§1.3).
5. `docs/superpowers/specs/2026-09-25-dgk-clock-phase1-foundation-design.md` and `docs/superpowers/plans/2026-09-25-dgk-clock-phase1-foundation.md`. Phase 1 is already planned task by task, so execute that plan as written.
6. The whole `src/` and `supabase/` tree.
7. `docs/progress/BUILD-LOG.md`, if it exists. If it does, you are resuming: continue from the first unchecked item.

## 1.2 How you work
- **Resumable log.** Create `docs/progress/BUILD-LOG.md` at the start. After every task, append:
  - phase and task
  - status
  - the commit SHA
  - the commands you ran and their pass/fail result
  - any decision you made
  Keep a checklist of every task in every phase at the top. A new session must be able to resume from this file alone.
- **Plan per phase.** For Phases 2–8:
  - Before coding, write `docs/superpowers/specs/<date>-dgk-clock-phaseN-<name>-design.md` (short: decisions, data changes, screens, tests).
  - Also write `docs/superpowers/plans/<date>-dgk-clock-phaseN-<name>.md`, with bite-sized TDD tasks of 2–5 minutes each.
  - Base both on the code as it actually exists after the previous phase. Don't wait for approval between phases unless a STOP condition applies. Dilip reviews at the end.
- **Test first.** Every task: write the failing test (pgTAP or Vitest), run it and see it fail, write the minimum code, run it and see it pass, refactor, commit.
- **Subagents.** Delegate isolated tasks (one migration plus its pgTAP file, one component plus its test) to subagents with a precise brief: the files, the rule numbers and the acceptance test. After each subagent returns, review its diff against the spec yourself before committing. At the end of each phase, run one fresh reviewer subagent over the whole phase diff. It checks rules coverage, RLS holes, timezone bugs, float minutes and brand drift, and you fix what it finds. If the superpowers plugin is installed, use `subagent-driven-development`, `test-driven-development` and `verification-before-completion`. If it isn't, follow the same discipline by hand.
- **Evidence, not claims.** Never write "done", "works" or "passes" without pasting the command output into the log.
- **Git.** Work on branch `feat/placement-system`, with one commit per task (Conventional Commits, e.g. `feat(hours): R5.4.2 break deduction`) and a tag at the end of each phase (`phase-N-done`). Push the branch to GitHub after each phase. Never push to `main`.
- **Local only.** Use the local Supabase stack (`supabase start`) for everything. `supabase db reset` must rebuild the whole schema and seed from scratch at all times.
- **Ask only when blocked.** If a rule is ambiguous but reversible, choose the option that matches the spirit of §6–§10, record it under "Assumptions" in the log, and continue.

## 1.3 STOP conditions (stop, explain, wait for Dilip)
1. Any command that touches the **hosted** Supabase project `lnagrfdbmwtlymhumepc`:
   - `supabase link`
   - `db push`
   - `functions deploy`
   - `secrets set`
   - deleting the remote `create-staff` function
   - changing Auth settings
2. Merging or pushing to `main`, or anything that deploys GitHub Pages.
3. A contradiction between two binding sources that changes behaviour an intern or university would notice.
4. Needing a library that isn't in §5.5.
5. A verification gate that still fails after 3 genuine fix attempts. Stop and report; don't weaken the test.
6. Anything that would delete real people's data outside the designed retention job.

---

# 2. The product on one page

- **DGK Business Consultancy** is a small Darwin consultancy that hosts university **interns** on placement at **Regus, Level 1, 1 Palmerston Circuit, Palmerston City NT 0830** (lat `-12.4785082`, lng `130.9854825`, radius **200 m**).
- **Scale:** 3–10 interns at a time, 1–3 supervisors, 1 admin (Dilip). Design and test for 200 placements so it never slows down.
- **Devices:** interns use phones (clocking in at the office). Supervisors use phone and laptop. The admin mostly uses a laptop.
- **Timezone:** `Australia/Darwin` (UTC+09:30, no daylight saving) for **every** date and time.
- **Notifications:** in-app only. The only email is Supabase's password reset.

**Jobs to be done**
| Who | When… | …they want to | Success signal |
|---|---|---|---|
| Intern | arriving at the office | clock in with a selfie in one tap | green "You're in since 8:58" |
| Intern | any day | know if they're on track | hours ring, pace chip, "Week 6 of 13" |
| Intern | their plans change | swap a day, take leave or add a day | request sent, status visible |
| Intern | they fell behind | see the exact way to catch up | pick option A or B, submitted as requests |
| Supervisor | morning | see who's in and who's late | today board |
| Supervisor | anytime | clear approvals fast | inbox, one-tap approve or decline with preview of the effect |
| Supervisor | weekly | rate the intern | 3 sliders plus a comment in 30 seconds |
| Admin | weekly | know if placements will finish on time | "% on pace" headline plus the at-risk list |
| Uni | end of placement | trust the hours | signed PDF with weekly counted hours |

---

# 3. Architecture constraints (non-negotiable, ADR 0001)

- **Next.js 16.3** App Router, React 19, TypeScript 5 strict, Tailwind 4, shadcn/ui (radix-nova), `sonner`, `lucide-react`.
- **Static export to GitHub Pages** (`output: "export"`, `basePath: "/presence-tracker"` when `GITHUB_PAGES=true`). There is **no server at runtime**. That means:
  - no server actions, route handlers, runtime middleware or `cookies()`/`headers()`
  - no dynamic route segments (`[id]`). Use query strings (`/admin/placement?id=…`) read with `useSearchParams()` inside a `<Suspense>` boundary.
  - every page is a client-rendered shell that fetches through the Supabase JS client
  - every asset URL respects `NEXT_PUBLIC_BASE_PATH`
- **All business logic lives in Postgres:**
  - tables, constraints, triggers, RLS, views and functions
  - `pg_cron` for schedules; if it's unavailable, a GitHub Actions scheduled workflow calling an Edge Function with a secret header
  - `pg_net` plus Edge Functions **only** where Postgres can't do the job (Storage object deletion and Auth user deletion)
- The browser **only displays and submits**. Client-side validation is for UX; the database re-validates everything.
- **Security pattern (keep):**
  - privileged logic goes in `private` schema `SECURITY DEFINER` functions with `set search_path = ''` and fully qualified names
  - thin `public` `SECURITY INVOKER` wrappers for anything the client calls
  - `revoke all … from public, anon`, then explicit `grant execute … to authenticated`
- **Naming:** keep the `daymark_` prefix on every table, view and function.
- **Supabase free plan:** there are no backups and the project pauses after 7 days idle. The release checklist (§21) covers this.
- **Test clock:** `private.clock_now()` returns `now()`, except when `session_user = 'postgres'` and `current_setting('daymark.test_now', true)` is set. Every rule reads time through it, never through `now()` directly.

---

# 4. Glossary (compact — full definitions in `CONTEXT.md`)

- **Person** — anyone with a login. Role flags: `is_intern`, `is_supervisor`, `is_admin`. A person may hold several.
- **Intern** — the only role that clocks in. Never "staff" or "student" in the UI.
- **Supervisor** — approves requests, does weekly check-ins, approves the uni report.
- **Admin** — Dilip. Can do anything and receives escalations.
- **Cohort** — named intake group.
- **Placement** — one intern's internship: start date, planned end date, target hours, supervisor, cohort, site.
- **Target Hours** — the placement **completes when counted hours reach the target**. The **Planned End Date** is the pacing reference.
- **Weekly Pattern** — the intern's usual weekdays and times. It generates the **Schedule**, a list of **Scheduled Days**.
- **Site** — the office.
- **Closure Day** — a public holiday or office closure. Weekends are always closed.
- **Clock-in Window** — Mon–Fri 07:00–19:00.
- **Capacity** — **Standard 3** (what interns see), **Hard 4**. The 4th spot is an **Extra Spot** (supervisor approval, then admin approval). A **5th is impossible**.
- **Clocking records:**
  - **Punch** — a clock-in or clock-out
  - **Shift** — a clock-in plus its clock-out
  - **Auto-closed Shift** — no clock-out by 19:00
  - **Unscheduled Shift** — a shift on a date with no scheduled day
- **Hours terms:**
  - **Worked Hours** — shift time minus the **Break Deduction**
  - **Counted Hours** — worked, capped at the scheduled length, plus approved **Overtime**
  - **Short Time** — scheduled length not worked
  - **No-show** — scheduled day passed with no shift and no leave
  - **Owed Balance** — expected minus counted
- **Grace Period** — 15 min. **Late** is punctuality only.
- **Pace / Forecast Finish / At Risk** — see §8.8–§8.10.
- **Request types:** Swap, Shift Change, Extra Day, Leave (sick/personal), Punch Fix, Overtime, Pattern Change. **Escalation** happens after 72 h. Nothing is ever auto-approved.
- **Catch-up Plan**, **Work Log**, **Check-in**, **Monday Summary**, **Uni Report**, **Certificate**, **Exit Feedback**.
- **Retention Period** — 30 days after the placement ends, then everything is permanently deleted.

---

# 5. Current codebase facts and conventions

## 5.1 What exists
- **Tables:**
  - `daymark_profiles` (single `role` column `admin|staff` → replaced by flags in Phase 1)
  - `daymark_punches` (`shift_in|shift_out|break_in|break_out`, lat/lng, `accuracy_m`, `photo_path`, `place_name`)
  - `daymark_login_secrets` (**plain-text passwords — delete in Phase 1**)
- **Trigger** `private.enforce_punch_sequence()` hard-codes the site. Phase 1 replaces it with `private.punch_rule_error()` and the `daymark_punches_rules` trigger reading `daymark_sites`.
- **Storage:** bucket `daymark-photos` (private, JPEG ≤ 5 MB, path `<user_id>/<uuid>.jpg`).
- **Client:**
  - `src/lib/daymark.ts`, `time.ts` (break logic → rewrite), `punches.ts`
  - `src/app/clock/*` (intern), `src/app/admin/*`
  - `src/components/punch-day-table.tsx`
- **Security issues to fix in Phase 1:**
  - `sign_in_email`, `recovery_email_ready` and `save_own_password` RPCs
  - the unused Edge Function `create-staff`
  - `set_login_email`, which references the removed `role` column
  - `src/lib/profile.ts`, which is unused

## 5.2 SQL conventions
- New timestamped migrations only (`YYYYMMDDHHMMSS_description.sql`). **Never edit an existing migration.**
- Reference rule numbers in comments (`-- R5.4.2`).
- Minutes are `integer` everywhere (**never floats or intervals in results**).
- Dates are Darwin `date`s, times of day are `time`, instants are `timestamptz`.
- Every FK is indexed, and every table has RLS enabled with explicit policies.
- Friendly error messages in the existing tone. Raise them with `using errcode = 'P0001'` and a human sentence, e.g. *"You're 340 m from the office. Move closer to clock in."*
- Every approval, admin edit, punch fix, capacity override and deletion writes `daymark_audit_log`.

## 5.3 TypeScript conventions
- Strict TypeScript with generated types (`supabase gen types typescript --local > src/lib/database.types.ts`).
- Small typed data hooks in `src/lib/data/*`.
- Forms use `react-hook-form` + `zod`.
- Dates: `date-fns` + `@date-fns/tz` with `TZDate` in `Australia/Darwin`. **Never** use the browser's local timezone for business logic.
- Minutes are displayed with one helper, `formatMinutes(450) → "7h 30m"`, `formatMinutes(-90) → "1h 30m ahead"`.

## 5.4 Copy
- Plain, friendly Australian English, second person, short.
- Words to use: "clock in", "hours owed", "ahead", "extra spot", "swap".
- Never blame. Always say what to do next.

## 5.5 Allowed libraries
Already present, plus:
- `date-fns`, `@date-fns/tz`
- `react-hook-form`, `zod`, `@hookform/resolvers`
- shadcn components (incl. Calendar, Chart/`recharts`, Sheet, Drawer, Command)
- `@react-pdf/renderer`, `papaparse`
- `vitest`, `@testing-library/*`, `jsdom`, `@types/node@^22`
- `@playwright/test` (e2e, dev only)
- `sharp` (dev only, icons)

Anything else → STOP condition 4.

---

# 6. Roles and permissions (enforced by RLS, never by hiding buttons)

| Action | Intern (self) | Supervisor (own interns) | Admin |
|---|---|---|---|
| Clock in/out, work logs | ✅ | — | — |
| View schedule, hours, requests, dashboard | ✅ own | ✅ | ✅ all |
| Who's in today | names + status, count as **x/3** | + times + extra-spot marker | same as supervisor |
| Create requests | ✅ own | — | — |
| Decide requests | — | ✅ first step | ✅ any step, incl. escalated and extra spots |
| Weekly check-ins | — | ✅ | ✅ |
| Create/edit placements, cohorts, patterns directly | — | — | ✅ |
| Extend end date, confirm completion, withdraw | — | ✅ | ✅ |
| Sites, closure days, settings, people, CSV import | — | — | ✅ |
| Uni report and certificate | ✅ download after supervisor approval | ✅ approve + download | ✅ |
| Selfies | ✅ own | ✅ their interns | ✅ |

**Helpers:** `private.is_admin()`, `private.is_supervisor_of(intern_id)`, `private.can_view_placement(placement_id)`, `private.current_placement(intern_id)`. They must be `stable`, and RLS policies must call them as `(select private.fn())` so the planner caches them.

**Multi-role people:** after sign-in, a person lands on their highest role's home (admin → supervisor → intern). A role switcher in the header lists only the roles they hold.

**Guard:** a trigger prevents removing or deactivating the **last active admin**.

---

# 7. Business rules (binding — every rule needs ≥ 1 test)

## 7.1 Clocking (R5.1)
- **R5.1.1** Only people with `is_intern` and `active` can clock in, and only with a placement in `active` or `extended` status.
- **R5.1.2** Punches are allowed only:
  - within the site radius (haversine distance ≤ `radius_m`)
  - Mon–Fri, 07:00–19:00 Darwin time, inclusive of 19:00:00
  - not on a closure day
- **R5.1.3** A device punch requires a selfie `photo_path` and GPS.
- **R5.1.4** New punches may only be `shift_in` or `shift_out`. Old break rows are kept and ignored.
- **R5.1.5** Punch order alternates `shift_in` → `shift_out` → `shift_in`… Multiple shifts per day are allowed.
- **R5.1.6** A `shift_in` is blocked until the work log for the intern's **previous shift date** exists. A clock-out is never blocked.
- **R5.1.7** System punches have `source ∈ {auto_close, punch_fix}` with no photo or GPS.
- **R5.1.8** A `shift_in` on a date with no scheduled day starts an **unscheduled shift**. It is blocked if the site already has 4 scheduled that day.

## 7.2 Schedule (R5.2)
- **R5.2.1** A pattern day is Mon–Fri only, within 07:00–19:00, with end > start, length ≤ 600 min and 15-min steps.
- **R5.2.2** The schedule is generated for every pattern weekday from the start date to the planned end date, skipping weekends and closure days.
- **R5.2.3** Maximum one live day (`scheduled` or `leave`) per placement per date.
- **R5.2.4** `planned_minutes = (end − start) − (30 if (end − start) > 300 else 0)`.
- **R5.2.5** *(added)* If the admin adds a closure day after generation, affected `scheduled` days become `cancelled`. These days are **not owed**, and the intern is notified.

## 7.3 Capacity (R5.3)
- **R5.3.1** Headcount = count of `scheduled` days at the site on that date.
- **R5.3.2** Standard capacity is 3 and hard capacity is 4, stored per site.
- **R5.3.3** Interns see `x/3` and "Full" at 3, and never see 4 as possible. At 3 they get the option "Request an extra spot (needs admin approval)".
- **R5.3.4** Anything that would make headcount 4 sets `needs_extra_spot`. It then needs supervisor approval, then admin approval.
- **R5.3.5** Headcount 5+ is rejected everywhere, enforced by a trigger as a last line of defence.
- **R5.3.6** Capacity is re-checked at every approval step, under a lock (§8.5).
- **R5.3.7** An admin editing directly can place a 4th person after a confirmation dialog (an audited override), but never a 5th.

## 7.4 Hours per placement per date (R5.4) — integer minutes
- **R5.4.1** `raw` = Σ(clock_out − clock_in) over the day's closed shifts.
- **R5.4.2** `break` = 30 if `raw` > 300 **and** no gap of ≥ 30 min between consecutive shifts that day, else 0.
- **R5.4.3** `worked = raw − break`.
- **R5.4.4** `countable = min(worked, 600)`. Anything above is shown as "over maximum day length" and never counts.
- **R5.4.5** `scheduled` = `planned_minutes`, or 0 if unscheduled, on leave or cancelled.
- **R5.4.6** `base = min(countable, scheduled)`.
- **R5.4.7** `overtime = max(0, countable − scheduled)`. When the day closes, this upserts an `overtime` request in `pending_supervisor` with `requested_minutes = overtime`.
- **R5.4.8** `approved_ot` is the supervisor's approved minutes, 0 ≤ approved ≤ requested. Partial approval is allowed.
- **R5.4.9** `counted = base + approved_ot`.
- **R5.4.10** `short = max(0, scheduled − worked)`, computed only once the day is **closed** (Darwin now ≥ date 19:00, or date < today).
- **R5.4.11** Counting is length-based (ADR 0002). Starting at 8:30 against a 9:00 schedule and working a full length gives a full day, not overtime.
- **R5.4.12** **Late** = first clock-in > scheduled start + 15 min. Late is punctuality only.
- **R5.4.13** **Left early** = last clock-out < scheduled end **and** `short` > 0.

## 7.5 Auto-close and no-shows (R5.5)
- **R5.5.1** Auto-close runs at 19:05. Any shift still open gets a system clock-out at the **scheduled end time**. If the clock-in was after the scheduled end, or the shift was unscheduled, the clock-out = the clock-in (0 min). The shift is flagged `auto_closed`, and the intern is told to submit a punch fix.
- **R5.5.2** A past `scheduled` day with no shifts is a **no-show** (`short` = the full length).
- **R5.5.3** 2 or more no-shows in the current fortnight notify the supervisor (once per fortnight per intern).

## 7.6 Owed balance (R5.6)
- **R5.6.1** `expected_to_date` = Σ `planned_minutes` of days with status `scheduled` or `leave` and date < today, plus today once it's closed.
- **R5.6.2** `counted_to_date` = Σ `counted` over those dates, plus approved overtime on unscheduled shifts.
- **R5.6.3** `owed = expected − counted`. Positive means owed; negative means ahead.
- **R5.6.4** Leave never reduces target hours. Approved overtime pays down the owed balance.

## 7.7 Periods (R5.7)
- **R5.7.1** Weeks run Mon–Sun.
- **R5.7.2** Fortnights are company-wide, anchored on `settings.fortnight_anchor` (default **Mon 2026-09-28**).
  - `fortnight_index(d) = floor((d − anchor) / 14)`, using a real floor for dates before the anchor.
  - `fortnight_start = anchor + 14·index`.
- **R5.7.3** Placement week:
  - `week_no(d) = floor((monday(d) − monday(start)) / 7) + 1`
  - total weeks = `week_no(planned_end)`
  - shown as "Week 6 of 13"

## 7.8 Progress, forecast, at risk (R5.8–R5.10)
Algorithms are in §8.

**Pace colours:**
- green = forecast ≤ planned end
- amber = 1–5 calendar days late
- red = more than 5 days late, or no forecast is possible

**At risk (any one):**
- `schedule_gap` > 240
- `owed` > 240
- ≥ 2 no-shows in the fortnight
- forecast more than 5 days after the planned end
- latest check-in average < 3.0

## 7.9 Lifecycle (R5.11)
- **R5.11.1** `counted_total ≥ target` → status `target_reached` (set by the day-close job) and the supervisor is notified. Clock-in is then blocked by R5.1.1.
- **R5.11.2** The supervisor confirms completion → status `completed`, `ended_on = today`, and future days are `cancelled`.
- **R5.11.3** Extending the planned end date → status `extended` (behaves like `active`). Days for the added period are generated from the current pattern.
- **R5.11.4** Withdraw → status `withdrawn`, `ended_on = today`, and future days are cancelled.
- **R5.11.5** After `completed` or `withdrawn`, the intern is **read-only**: they can view and download, and give exit feedback.
- **R5.11.6** On `ended_on + 30 days`, **permanently delete everything** for that intern (ADR 0003). The deletion order is in §8.12.
- **R5.11.7** Reminders go to the intern and supervisor on **day 0, 14 and 25** after `ended_on`.

## 7.10 Escalation (R5.12)
- **R5.12.1** A request that has been `pending_supervisor` for more than 72 h gets `escalated_at` set and the admin is notified. The admin may then decide it.
- **R5.12.2** No request is ever approved or declined automatically.

---

# 8. Algorithms (implement exactly; complexity targets are requirements)

**Notation:**
- `P` = placements (design for 200)
- `D` = days in a placement (≤ ~300)
- `F` = future days
- `k` = punches in a day (≤ ~8)
- `H` = history window

All functions live in `private`, are pure where possible and read time via `private.clock_now()`.

## 8.1 Shift building — `private.rebuild_shifts(placement_id, work_date)`
```
punches ← device/system punches for (intern, date) where type in (shift_in, shift_out)
          and id not in (select replaces_punch_id …)          -- punch fixes supersede originals
sort by occurred_at                                            -- O(k log k)
delete daymark_shifts for (placement, date); open ← null
for p in punches:
  if p.type = shift_in:  open ← p            (a second consecutive shift_in is impossible: trigger R5.1.5)
  else if open ≠ null:   insert shift(open, p); open ← null
if open ≠ null: insert shift(open, null)                       -- currently open
```
- Called by an AFTER trigger on `daymark_punches` (statement-safe, per affected date) and by punch-fix approval.
- **Complexity:** O(k log k) per event.

## 8.2 Day result — `private.compute_day(placement_id, work_date) returns daymark_day_results%rowtype`
The single source of truth for R5.4, implemented once as a pure function.
```
S ← closed shifts of the day ordered by clock_in
raw ← Σ minutes(s.out − s.in)
gap_break ← exists consecutive (a,b) in S with b.in − a.out ≥ 30 min
brk ← (raw > 300 and not gap_break) ? 30 : 0
worked ← raw − brk ; countable ← min(worked, 600) ; over_max ← max(0, worked − 600)
sched ← scheduled day with status 'scheduled' on date ? planned_minutes : 0
base ← min(countable, sched) ; overtime ← max(0, countable − sched)
approved_ot ← approved_minutes of the day's approved overtime request, else 0
counted ← base + approved_ot
closed ← clock_now() ≥ (work_date + 19:00 Darwin)
short ← closed ? max(0, sched − worked) : null
late ← sched > 0 and first(S).in > start + 15 min
left_early ← closed and sched > 0 and last(S).out < end and short > 0
no_show ← closed and sched > 0 and S = ∅
flags: auto_closed (any), unscheduled (sched = 0 and S ≠ ∅)
```
- **Complexity:** O(k).
- **Caching:** results are stored in **`daymark_day_results`** (PK `placement_id, work_date`), recomputed by `private.recompute_day()` from triggers on punches, shifts, scheduled days and overtime decisions, and by the nightly job for yesterday and today.
- `daymark_v_day_hours` is a thin RLS-respecting view over this table.
- **Reconciliation:** nightly `private.reconcile_day_results(14)` recomputes the last 14 days and logs any drift to the audit log. A pgTAP test asserts that cache = compute on the seed data.
- **Why cache:** dashboards become simple aggregates. Worst case is O(P·D) ≈ 60k small rows, versus recomputing 60k punch pairings per page load.

## 8.3 Owed balance and progress — `private.placement_progress(placement_id)`
```
closed_days ← day_results where work_date < today or (work_date = today and closed)
expected ← Σ planned_minutes over scheduled/leave days in closed_days range
counted_to_date ← Σ counted over closed_days (+ unscheduled approved OT)
owed ← expected − counted_to_date
counted_total ← Σ counted (all days incl. today's base so far)
remaining ← max(0, target − counted_total)
future_sched ← Σ planned_minutes of 'scheduled' days with date > today (+ today if no shift yet)
schedule_gap ← remaining − future_sched
week_no, total_weeks, fortnight bounds (R5.7)
```
- **Complexity:** O(D) using index `(placement_id, work_date)`.
- Exposed as `public.placement_progress(placement_id)` and in bulk as `public.progress_for_supervisor()` / `public.progress_all()`, each a single set-based query with no per-row function loops over punches.

## 8.4 Forecast finish — `private.forecast_finish(placement_id)`
```
if remaining = 0: return target_reached_at::date
win_start ← max(start_date, today − 28)
e ← Σ planned (scheduled+leave) in [win_start, today) ; c ← Σ counted in same
ratio ← e = 0 ? 1.0 : clamp(c / e, 0.2, 1.2)         -- numeric, not float
acc ← 0
for d in future 'scheduled' days ascending:             -- O(F)
  acc ← acc + planned(d) × ratio
  if acc ≥ remaining: return d
-- schedule exhausted → continue on latest pattern beyond planned_end
d ← max(planned_end, today) + 1 ; guard ← 0
while guard < 400:                                      -- hard bound, never infinite
  if weekday(d) in pattern and d not closure: acc += pattern_planned(weekday) × ratio
  if acc ≥ remaining: return d
  d ← d + 1 ; guard ← guard + 1
return null                                             -- UI: "Can't forecast — no usual days set"
```
- **Complexity:** O(F + 400) worst case, with closure days pre-loaded into a set, so there are no per-day queries.
- `days_late = forecast − planned_end` (calendar days). Pace colour follows §7.8.

## 8.5 Capacity check under concurrency — `private.assert_capacity(site_id, dates[], allow_extra bool)`
```
for d in sort(unique(dates)):                           -- sorted → no deadlocks
  perform pg_advisory_xact_lock(hashtextextended(site_id::text || d::text, 0))
counts ← select work_date, count(*) from scheduled_days
         where site_id = $1 and work_date = any(dates) and status = 'scheduled' group by 1
for each d: n ← counts[d] + delta(d)
  if n ≥ 5 → raise "That day already has 4 interns — the office limit."
  if n = 4 and not allow_extra → return needs_extra_spot
```
- Also add a **constraint trigger** on `daymark_scheduled_days` that re-counts after insert/update. It raises if the count > `hard_capacity`, and raises if the count = 4 unless `current_setting('daymark.extra_spot_ok', true) = 'on'`. Only the final extra-spot approval and the audited admin override set that, transaction-locally.
- **Complexity:** O(|dates| log n) with index `(site_id, work_date) where status = 'scheduled'`.

## 8.6 Schedule generation — `private.generate_days(placement_id, from_date, to_date, pattern_version_id)`
- Loop `generate_series` over dates, filtered by pattern weekday, not a weekend, not a closure day, and no existing live day.
- Insert the days with `source = 'pattern'`, as one set-based `insert … select`.
- **Complexity:** O(D).
- **Pattern change:** future `pattern` days that are still `scheduled` and on or after `effective_from` become `cancelled`. Regenerate from the new version. Days created by a swap, extra day, shift change or admin, and leave days, are kept. Capacity is checked over the whole regenerated set in **one** `assert_capacity` call: any day that would be a 5th rejects the request and lists the dates; any day that would be a 4th sets `needs_extra_spot`.

## 8.7 Catch-up planner — `public.catch_up_options(placement_id) returns jsonb`
Only runs when `owed > 0`. Earliest eligible date = the first weekday whose start is ≥ 24 h from now. Both options respect C1–C7 and **never** propose a 4th spot.

**Option A — Longer days** (→ `shift_change` requests)
```
need ← owed
for day in upcoming 'scheduled' days ascending (eligible, no pending request on date):
  L ← end − start ; best ← null
  for L' in L+15, L+30 … up to min(600, 720-window):
    try extend end first (≤ 19:00), then start earlier (≥ 07:00)
    gain ← planned(L') − planned(L)          -- planned() applies the 300→−30 rule
    best ← L' ; if gain ≥ need: break
  if best: emit(day, new times, gain) ; need ← need − gain
  if need ≤ 0: break
```
- **Complexity:** O(F × 40).

**Option B — Extra days** (→ `extra_day` requests)
```
times ← modal (start,end) of current pattern days
headcount ← one grouped query over [eligible, planned_end] → map  -- O(F)
for d ascending: weekday, not closure, no live day for intern, no pending request, headcount[d] < 3:
  emit(d, times, planned(times)) ; need ← need − planned(times) ; if need ≤ 0: break
```

Each option returns `{requests: [...], covers_minutes, owed_minutes, fully_covers: bool}`. The UI shows "Covers 6h of 7h 30m owed" when the option falls short.

`public.submit_catch_up(placement_id, option)` **recomputes** the option server-side and inserts all of its requests in one transaction (all or nothing). It never trusts client-supplied dates.

## 8.8 At risk — `private.risk_reasons(placement_id) returns text[]`
- Checks the five §7.8 tests in O(1) from progress plus one indexed count of no-shows in the fortnight plus the latest check-in.
- Returns reason codes: `schedule_gap`, `owed`, `no_shows`, `forecast_late`, `low_checkin`.
- The UI shows each code as a labelled chip.

## 8.9 Request validation — `private.validate_request(req) returns validation`
- Applies C1–C7 (§9) in order and returns the **first** failure as a friendly message, plus a computed `needs_extra_spot`.
- Called on insert (trigger), on every decision, and by the client-side preview RPC `public.preview_request(jsonb)`, so the form shows the exact server verdict before submit.

## 8.10 Escalation (hourly)
- `update … set escalated_at = clock_now() where status = 'pending_supervisor' and escalated_at is null and created_at < clock_now() − 72h returning *`, then notify the admin once per request.
- **Complexity:** O(pending) via a partial index.

## 8.11 Day close (19:10 nightly, idempotent)
- For each active placement with a day today:
  - auto-close (§7.5)
  - `rebuild_shifts`, then `recompute_day`
  - upsert or adjust the overtime request: if a later punch fix lowers overtime below an already approved amount, clamp `approved_minutes`, audit it and notify the supervisor
  - mark no-shows
  - check 2 no-shows → notify
  - check `target_reached`
- Running the job twice must change nothing. There is a pgTAP test for this.

## 8.12 Retention purge (02:00 nightly)
- `private.due_for_deletion()` = placements whose `ended_on + retention_days ≤ today`.
- Supabase blocks direct SQL deletes on `storage.objects`, and the Auth user should be removed with the Admin API. So deletion runs in the Edge Function `retention-purge`:
  1. Called by `pg_cron` → `pg_net` with a secret header; the fallback is a GitHub Actions cron.
  2. For each due intern:
     1. List and remove Storage objects under `daymark-photos/<intern>/` and `daymark-leave-docs/<intern>/` using the Storage API.
     2. Call `private.purge_intern(intern_id)`, which deletes in FK-safe order in one transaction: notifications → exit feedback → check-ins → work logs → requests → day results → shifts → punches → schedule history → scheduled days → pattern days → pattern versions → placements → profile.
     3. `auth.admin.deleteUser(intern_id)`.
     4. Write an audit row that contains **no personal data** (only a hash of the id, the counts deleted and the date).
  3. Reminders on days 0/14/25 go out from the same nightly SQL job.
- Verify this against the current Supabase docs in `node_modules`/web docs before building. If the direct-delete restriction doesn't apply to the local version, still use the Storage API.

## 8.13 Complexity summary
| Operation | Complexity | Budget (local, seeded 200 placements × 1 yr) |
|---|---|---|
| Clock in/out (trigger + rebuild + recompute) | O(k log k) | p95 < 150 ms |
| Intern dashboard RPC | O(D + F) | p95 < 150 ms |
| Supervisor dashboard RPC | O(P_s · D) | p95 < 250 ms |
| Admin dashboard RPC | O(P · D) aggregate | p95 < 400 ms |
| Approve request (validate + lock + write) | O(dates · log n) | p95 < 150 ms |
| Catch-up options | O(F · 40) | p95 < 200 ms |
| Nightly jobs | O(P · k) | < 5 s total |

Capture `EXPLAIN (ANALYZE, BUFFERS)` for the three dashboard RPCs in `docs/progress/perf.md` at the end of Phase 7. Add indexes until the budgets hold.

---

# 9. Requests (`daymark_requests`)

## 9.1 Common checks
These run at creation **and** at every decision.
- **C1** The placement is `active` or `extended`, and the intern isn't read-only.
- **C2** Every affected date is a weekday, not a closure day, not in the past, and ≤ the planned end date.
- **C3** Times are within 07:00–19:00, in 15-min steps, with length ≤ 600.
- **C4** Each affected day's start is ≥ 24 h away. Exempt: sick leave, overtime and punch fixes.
- **C5** At most one live day per date.
- **C6** Capacity per §8.5 (4 → `needs_extra_spot`; 5 → rejected).
- **C7** No other **pending** request from this intern touches the same date.

## 9.2 Request types
| Type | Intern provides | On final approval |
|---|---|---|
| `swap` | the day to move, a new date, optional new times, a reason | old day → `moved`; new day (`source = swap`) |
| `shift_change` | the day, new start/end, a reason | times updated; before/after row in `daymark_schedule_history` |
| `extra_day` | date, times, a reason | new day (`source = extra_day`) |
| `leave` | date(s), `sick`/`personal`, a reason, optional certificate (PDF/JPG/PNG ≤ 5 MB → `daymark-leave-docs`) | day(s) → `leave` (the hours stay owed) |
| `punch_fix` | date (≤ 7 days ago), corrected in and/or out time, a reason | corrective punches (`source = punch_fix`, `replaces_punch_id`); originals kept; shifts rebuilt; day recomputed |
| `overtime` | *system-created*; the intern adds a reason | the supervisor approves all or part |
| `pattern_change` | effective-from date (≥ 24 h ahead), the new pattern, a reason | new pattern version; regenerate per §8.6 |

**Leave rules:**
- Sick leave needs no notice and may be submitted up to 2 days after the date.
- Personal leave needs 24 h notice.
- Leave on a day that already has shifts is rejected.

**Punch fix rules:**
- The corrected times must lie within the window.
- They must not overlap another shift.
- `out > in`.

## 9.3 State machine
```
pending_supervisor ──approve──▶ (needs_extra_spot ? pending_admin : approved)
pending_supervisor ──decline(note required)──▶ declined
pending_admin ──approve──▶ approved      pending_admin ──decline──▶ declined
pending_* ──intern cancel──▶ cancelled   admin may act at any pending step (incl. escalated)
```
- Every decision records who decided, when, and the note. Declines require a note.
- Every step re-runs `validate_request`. If capacity changed and the request now needs an extra spot, it moves to `pending_admin` with a system note.
- Effects are applied **only** on the transition to `approved`, in the same transaction.
- Every transition sends a notification to the relevant people.

---

# 10. Data model (target state)

```text
daymark_profiles         id=auth.users, login_id, display_name, contact_email, active,
                         is_intern, is_supervisor, is_admin, must_change_password, created_at
daymark_settings         singleton(id=1): fortnight_anchor, grace_minutes 15, max_day_minutes 600,
                         break_threshold_minutes 300, break_minutes 30, escalation_hours 72,
                         retention_days 30, notice_hours 24, punch_fix_days 7, sick_backdate_days 2
daymark_sites            id, name, address, latitude, longitude, radius_m 200, standard_capacity 3,
                         hard_capacity 4, window_start 07:00, window_end 19:00, active
daymark_closure_days     id, site_id null=all, day, name, kind(public_holiday|office_closure)
daymark_cohorts          id, name unique, starts_on, notes
daymark_placements       id, intern_id, supervisor_id, cohort_id, site_id, university, course,
                         uni_coordinator_name, uni_coordinator_email, start_date, planned_end_date,
                         original_end_date, target_minutes, status(active|target_reached|completed|extended|withdrawn),
                         target_reached_at, ended_on, report_approved_by, report_approved_at,
                         report_approval_note, created_by, created_at
                         -- partial unique: one live (active|extended|target_reached) placement per intern
daymark_pattern_versions id, placement_id, effective_from, request_id, created_by, created_at
daymark_pattern_days     id, pattern_version_id, weekday 1..5, start_time, end_time
daymark_scheduled_days   id, placement_id, site_id, work_date, start_time, end_time, planned_minutes,
                         source(pattern|swap|extra_day|shift_change|admin), status(scheduled|moved|leave|cancelled),
                         leave_kind, origin_request_id, created_at, updated_at
                         -- partial unique (placement_id, work_date) where status in ('scheduled','leave')
                         -- index (site_id, work_date) where status='scheduled'
daymark_schedule_history id, scheduled_day_id, before jsonb, after jsonb, changed_by, request_id, changed_at
daymark_punches          (existing) + placement_id, source(device|auto_close|punch_fix), replaces_punch_id
daymark_shifts           id, placement_id, work_date, clock_in_at, clock_out_at, in_punch_id, out_punch_id,
                         auto_closed, unscheduled
daymark_day_results      placement_id, work_date (PK), raw, break, worked, countable, over_max, scheduled,
                         base, overtime, approved_ot, counted, short, late, left_early, no_show,
                         auto_closed, unscheduled, closed, computed_at
daymark_requests         id, placement_id, intern_id, type, status, payload jsonb (zod-mirrored schema per type),
                         reason, attachment_path, needs_extra_spot, requested_minutes, approved_minutes,
                         supervisor_decision/id/decided_at/note, admin_decision/id/decided_at/note,
                         escalated_at, created_at, updated_at
daymark_work_logs        id, placement_id, work_date, summary 10–500 chars   -- unique (placement_id, work_date)
daymark_checkins         id, placement_id, supervisor_id, week_start, reliability, quality, communication 1..5,
                         comment  -- unique (placement_id, week_start)
daymark_notifications    id, person_id, kind, title, body, link, created_at, read_at
daymark_exit_feedback    id, placement_id, answers jsonb, submitted_at
daymark_audit_log        id, actor_id, action, table_name, row_id, before, after, at
```

**Views** (`security_invoker = true`):
- `daymark_v_day_hours`, `daymark_v_week_hours`, `daymark_v_fortnight_hours`
- `daymark_v_placement_progress`
- `daymark_v_today_board`
- `daymark_v_kpi_intern`, `daymark_v_kpi_supervisor`, `daymark_v_kpi_admin`

**Realtime:** publish `daymark_notifications` and `daymark_v_today_board`'s base tables (`daymark_punches` inserts). Clients subscribe with RLS, and fall back to 60-second polling if Realtime isn't available.

**Jobs** (`pg_cron`, UTC; Darwin = UTC+09:30):
| Job | Darwin | UTC cron |
|---|---|---|
| Auto-close (§7.5) | 19:05 daily | `35 9 * * *` |
| Day close: results, no-shows, overtime requests, target reached | 19:10 daily | `40 9 * * *` |
| Escalation | hourly | `0 * * * *` |
| Monday summary + check-in due | Mon 06:00 | `30 20 * * 0` |
| Reconcile, retention reminders, purge trigger | 02:00 daily | `30 16 * * *` |

All jobs are idempotent and each is callable manually by the admin (`public.run_job(name)`). Report whether you used `pg_cron` or the GitHub Actions fallback.

**Seed** (`supabase/seed.sql`, local only):
- 1 site and all NT closure days for 2026 and 2027 (listed below)
- people: 1 admin (`admin@dgk.test`), 2 supervisors, 1 person who is both a supervisor and an intern, 7 interns
- 3 cohorts
- placements in every status
- about 10 weeks of realistic punches, including late days, auto-closed days, no-shows, overtime (pending, partial and approved), leave and swaps
- one placement at risk for each reason code
- one placement at day 13 after its end (to test reminders) and one at day 31 (due for deletion)

NT closure days to seed:
- **2026:** 01-01, 01-26, 04-03, 04-06, 05-04, 06-08, 07-24, 08-03, 12-25, 12-28
- **2027:** 01-01, 01-26, 03-26, 03-29, 04-26, 05-03, 06-14, 07-23, 08-02, 12-27, 12-28

A separate `supabase/tests/fixtures/perf.sql` holds 200 placements × 1 year for §8.13.

---

# 11. UX and UI design

## 11.1 Principles
1. **One primary action per screen.** For interns it's the Clock button; for supervisors it's Approve; for the admin it's reading the headline.
2. **Always say what happens next.** Every blocked state names the reason *and* the fix: "Write yesterday's work log to clock in → Write log".
3. **Show the effect before commit.** Every request and approval shows a preview from `preview_request`, e.g.:
   - "Tue 14 Oct becomes 9:00–17:00 · office 3/3 → Full"
   - "Owed 2h 30m → 0h"
4. **Numbers are human.** Write `7h 30m`, "Week 6 of 13" and "Finishes Fri 12 Dec · 3 days late". Show relative time up to 6 days, then dates.
5. **Colour is never the only signal.** Every status has an icon and a label.
6. **Fast on a bad phone.** Show skeletons, not spinners. Update optimistically only for read-marks. No layout shift.

## 11.2 Information architecture (static routes only)
- **Public**
  - `/` — sign in (email + password)
  - `/reset-password` — reset password. It always shows the neutral message *"If that email has a DGK Clock login, we've sent a reset link."*
  - `/set-password` — shown when `must_change_password` is set
- **Intern `/clock`** — mobile bottom tab bar (5 tabs):
  - **Today** `/clock`
  - **Schedule** `/clock/schedule`
  - **Requests** `/clock/requests`
  - **Progress** `/clock/progress`
  - **Me** `/clock/me` (work logs, reports, exit feedback, sign out)
- **Supervisor `/supervisor`** — tabs on mobile, left sidebar at ≥ 1024 px:
  - **Today** — board, approvals and at-risk
  - `/supervisor/approvals`
  - `/supervisor/interns`
  - `/supervisor/intern?id=`
  - `/supervisor/checkins`
  - `/supervisor/summary` (the Monday summary)
- **Admin `/admin`** — sidebar:
  - **Overview** (KPIs)
  - `/admin/placements`, `/admin/placement?id=`
  - `/admin/people`, `/admin/cohorts`, `/admin/import`
  - `/admin/requests` (all, including escalated)
  - `/admin/sites`, `/admin/closures`, `/admin/settings`
  - `/admin/reports`, `/admin/audit`
- **Shared:**
  - `/notifications`
  - header bell with unread count
  - role switcher
  - `DgkLogo` plus the page title

## 11.3 Key screens (build exactly these components)

**Intern — Today (`/clock`)**
- **Header row:** greeting with first name; "Week 6 of 13"; pace chip ("On pace", "3 days behind" or "Can't forecast").
- **ClockCard.** This is the hero element: a full-width card with a 64 px pill button. It's a state machine, and each state has distinct copy and icon:
  - `checking` → "Checking location…"
  - `blocked` → the reason plus the fix action. Reasons:
    - outside the window
    - weekend or closure day, with its name
    - too far, with the distance in metres
    - work log missing
    - read-only
    - office full (for an unscheduled shift)
  - `ready_in` → "Clock in"
  - `camera` → a full-screen selfie capture with a front-camera oval guide and retake
  - `submitting`
  - `in` → "You're in since 8:58", a live elapsed timer (`aria-live="polite"`, updating each minute) and a "Clock out" button (secondary style, to avoid misclicks)
  - `done` → "Day done · 7h 30m counted"
- **Today strip:** scheduled times, "Late" chip if applicable, and the office headcount "2/3 in today" with avatars (initials).
- **Mini metrics:** "This week 15h / 22h 30m" and "Owed 1h 30m" (or "Ahead 45m", in teal).
- **Owed card:** when owed > 0, show a "Catch up" card that opens a bottom sheet with Option A and Option B side by side. Each option lists its days, the "Covers X of Y" line and a single "Send requests" button.
- **Notifications preview:** the last 2 notifications.

**Intern — Schedule.** A week view on mobile and a month calendar on desktop.
- Day cells show times and a status: scheduled / leave / moved / closure / worked (✓ counted) / no-show / today.
- Tapping a day opens a sheet with actions filtered by the rules: Swap, Change times, Leave, Punch fix (if ≤ 7 days ago), plus an office headcount per day (x/3).
- A full day shows "Full — request an extra spot (needs admin approval)".

**Intern — Requests.** Tabs: Pending / Decided.
- **New request form:** a type picker, fields for that type, and a live **Preview panel** (the server verdict). The Submit button is disabled with the reason while the request is invalid.
- **Status timeline:** submitted → supervisor → admin (if an extra spot is needed) → outcome.

**Intern — Progress.**
- A hours ring (counted / target) with the remaining hours in the centre.
- A forecast line against the plan: a recharts area of cumulative counted vs planned, a dashed forecast, and a marker at the planned end date.
- Weekly bars (counted vs scheduled).
- On-time %, attendance % and the work-log streak.

**Intern — work log gate.** A sheet: 1–3 lines, 10–500 characters, with a counter and a prompt ("What did you work on? What did you learn?"). It's submitted before clock-in and is also accessible from Me.

**Supervisor — Today.**
- A **Today board** table: intern / scheduled / status chip (Not in yet · In since · Done · Late · Leave · No-show · Unscheduled) / hours today. Header "3/3 today (+1 extra spot)".
- An **Approvals** list sorted oldest first. Each row shows the type icon, intern, the dates, a one-line effect preview and the age ("26 h", amber at > 48 h, red when escalated).
- **Approve/Decline sheet:** the full preview, the capacity after approval, and a partial-minutes stepper for overtime (15-min steps). Decline requires a note, with quick-pick reasons.
- An **At risk** list with reason chips.

**Supervisor — Intern detail.**
- Header: progress ring, pace, forecast, owed, attendance and on-time.
- Tabs: Schedule, Hours (day table with raw/break/worked/counted/short and flags), Requests, Work logs, Check-ins, Selfies (a thumbnail grid opened from the day table).
- Actions: extend end date, confirm completion, withdraw (confirmation dialog + reason), approve uni report.

**Supervisor — Check-in.** Three 1–5 segmented controls (Reliability, Quality of work, Communication) with anchors ("1 Needs a lot of help … 5 Excellent"), a comment, and a "Due" badge on Monday.

**Supervisor — Monday summary.** One card per intern covering last week: counted vs scheduled, late count, no-shows, overtime pending or approved, work-log %, notes. It's printable.

**Admin — Overview.**
- A 9-KPI grid (§12) with **"% on pace"** as the large hero tile.
- Below it: the at-risk table, the escalated requests, desk use this fortnight (a heatmap calendar of daily headcount 0–4, with 4 outlined), and finishing soon.

**Admin — Placements.**
- A table with filters (cohort, status, supervisor, pace).
- A create/edit wizard: 1 Intern → 2 Dates & target → 3 Weekly pattern (a weekday grid with time pickers in 15-min steps and live planned minutes per day and per week, plus a capacity preview across the date range with conflicts highlighted) → 4 Review.

**Admin — Import.**
- Upload a CSV and get a **dry-run** table with a per-row ✓/✗ and error text, then "Import N rows" (all or nothing).
- **Columns:** `display_name,email,university,course,start_date,planned_end_date,target_hours,supervisor_email,cohort,pattern`.
- **Pattern syntax:** `Mon 09:00-17:00; Wed 09:00-17:00`.
- The admin enters one temporary password for the batch. It's never stored and never shown again. Interns must change it at first sign-in.
- Provide a template download.

**Admin — Sites / Closures / Settings / People / Audit.** Simple CRUD tables with confirmation dialogs. People has the role checkboxes, a write-only "Set password" field and deactivate. Audit is a filterable log.

## 11.4 States (every data view must implement all of them)
- **Loading:** skeleton shaped like the content.
- **Empty:** illustration-free, with one sentence and a next action ("No requests yet. Need to change a day? New request").
- **Error:** the friendly database message and "Try again".
- **Offline:** banner "You're offline — clocking needs a connection".
- **Read-only:** banner "Your placement has ended. You can view and download until {date}."
- **Permission:** "You don't have access to this page" with a link home.

## 11.5 Interaction and accessibility
- WCAG 2.1 AA: 44 px targets, a visible 2 px Violet focus ring with a 2 px offset, labels on every input, and `aria-describedby` for errors.
- Toasts (sonner) are announced.
- Honour `prefers-reduced-motion`. Motion is 150–200 ms ease-out and only on sheets, toasts and the ring fill.
- Keyboard: every dialog traps focus, Esc closes, Enter submits.
- Tables become stacked cards below 640 px.
- Dates are formatted `EEE d MMM` ("Tue 14 Oct") and times `h:mm a` ("9:00 am").
- **PWA:** manifest and icons only (no service worker), `display: standalone`, theme colour `#f9f8f6`.

---

# 12. KPIs (exact definitions; each has a unit test on seed data)

**Intern (8)**
1. **Hours ring** — `counted_total / target`, with remaining.
2. **Weeks** — "Week x of y".
3. **Forecast vs plan** — forecast date, days late or early, and the pace chip.
4. **Owed / ahead** — the owed balance.
5. **This week** — counted vs scheduled (Mon–Sun).
6. **On-time % and attendance %** (last 28 days):
   - attendance = attended scheduled days / past scheduled days (leave excluded)
   - on-time = attended days not late / attended days
7. **Work-log streak** — consecutive shift dates with a log.
8. **Pending requests** — count.

**Supervisor (8)** — scoped to their interns:
1. **Today board.**
2. **Approvals waiting** — count, and the oldest age in hours.
3. **At-risk list** — with reasons.
4. **Forecast vs planned end** — per intern.
5. **Attendance / on-time %** — this fortnight.
6. **Overtime approved** — this fortnight, in hours.
7. **Work-log completion %** — shift days with a log / shift days, this fortnight.
8. **Last check-in** — date and average; overdue if more than 7 days ago.

**Admin (9)**
1. **Active / starting / finishing** — active count; starting in the next 14 days; planned end in the next 14 days.
2. **% on pace** (hero) — active placements with a green pace / active placements.
3. **Counted hours** — this fortnight and all time.
4. **Average attendance / on-time %** — across active placements.
5. **No-shows and missed punches** — auto-closed shifts, this fortnight.
6. **Approval turnaround** — median hours from creation to first decision, per supervisor, over the last 30 days.
7. **Desk use vs capacity** — Σ headcount / (3 × open days) this fortnight, plus the number of days at 4.
8. **Completion outcomes** — last 180 days: on time / late / withdrawn.
9. **Interns per supervisor.**

Each role's KPIs are served by one RPC (`public.kpi_intern()`, `public.kpi_supervisor()`, `public.kpi_admin()`) returning typed JSON, so each dashboard makes one round trip.

---

# 13. Reports, certificate, exit feedback

**Uni Report PDF** (`@react-pdf/renderer`, generated client-side):
- The DGK logo.
- Intern name, university, course and coordinator.
- Site, placement dates, target hours, counted total and status.
- A weekly table: week, scheduled, counted, overtime approved, leave days.
- Totals.
- The supervisor approval block: name, date and note.
- A **blank signature line and date line** for the uni.
- "Generated {Darwin timestamp}" and a document ID (the first 8 characters of a SHA-256 of placement id + generated_at).
- **No selfies, GPS or addresses.**
- The intern can download it only after `report_approved_at` is set. The supervisor or admin approves it once hours are final.

**Certificate PDF.** Landscape, available after `completed`: name, "completed {hours} hours of professional placement", dates, DGK Business Consultancy, and the admin's name and title. The layout uses brand colours sparingly: a teal ring motif and Navy text.

**Exit feedback.** Open while the intern is read-only. Five questions:
1. Overall experience (1–5)
2. What you learned most
3. Supervisor support (1–5)
4. One thing we should change
5. Would you recommend DGK? (Yes/No)

The admin sees the aggregate; the intern sees their own. It's deleted with the placement.

---

# 14. Security and privacy checklist
- **Passwords.** No password can be read by anyone. Delete `daymark_login_secrets` and all references. Admin "set password" is write-only.
- **Sign-in.** Email + password. Delete `sign_in_email`, `recovery_email_ready` and `save_own_password`. The reset message is always neutral.
- **RLS tests (pgTAP)** for every table, covering at least:
  - intern A can't read intern B
  - a supervisor can't read a non-assigned intern
  - an intern can't update any request status field
  - an intern can't insert a punch for someone else or a system-source punch
  - anon can do nothing
- **Storage policies.** Owner, their supervisor or admin can read. Only the owner can insert under their own prefix. No public URLs; use signed URLs with a 60-second TTL.
- **Validation.** Every RPC validates inputs server-side. Every `payload jsonb` is checked against a per-type SQL validator.
- **Secrets.** The service role key never reaches the client. Edge Functions verify a shared secret header (for cron calls) or the caller's JWT and admin flag.
- **Audit.** The audit log is append-only: no update or delete policy, not even for the admin.
- **Content Security Policy.** Add a `<meta http-equiv="Content-Security-Policy">` restricting sources to self plus the Supabase URL (GitHub Pages can't set headers). Confirm it doesn't break the camera.

---

# 15. Brand system (DGK) — implement as tokens, never hard-coded hex in components

Put the tokens in `src/app/globals.css` (Tailwind 4 `@theme inline` plus shadcn variables):

```css
:root {
  --background:#f9f8f6; --foreground:#0d1117;           /* Warm Cream page, Navy Ink text */
  --card:#ffffff; --card-foreground:#0d1117;
  --popover:#ffffff; --popover-foreground:#0d1117;
  --primary:#3859f9; --primary-foreground:#ffffff;       /* Violet Pulse: actions, links, active */
  --secondary:#ffffff; --secondary-foreground:#0d1117;
  --muted:#e6e8ec; --muted-foreground:#55534e;           /* Cool Mist / Stone Gray */
  --accent:#e6e8ec; --accent-foreground:#0d1117;
  --border:#dad4c8; --input:#dad4c8; --ring:#3859f9;     /* Sand Border */
  --destructive:#b42318;
  --ash:#9f9b93; --lavender:#b8a5e8; --teal:#0ec5b0; --brand-orange:#ff7614; --brand-green:#02693e;
  --ok:#02693e;   --ok-bg:#e3f3ea;
  --warn:#b54c00; --warn-bg:#fff1e6;
  --bad:#b42318;  --bad-bg:#fdecea;
  --radius:12px;
  --shadow-card: rgba(13,17,23,.10) 0 1px 1px 0, rgba(13,17,23,.04) 0 -1px 1px 0 inset, rgba(13,17,23,.05) 0 -.5px 1px 0;
}
```

- **Type:** Inter only (400/500/600/700) via `next/font/google`.
  - Body 16/1.6, small 14.
  - Captions 12, uppercase, 0.09em tracking.
  - H2 20/600; H1 32/700 with −0.32px tracking.
  - Numbers use `tabular-nums`.
- **Shape:**
  - Buttons are **pills** (`rounded-[1584px]`), 44 px minimum height.
  - Inputs and nav items 8 px; metric cards 12 px; panels 16 px; chips 2.75 px.
- **Layout:** sticky 56 px header (white 95% with backdrop blur, Sand bottom border); max width 1200 px; card padding 24 px; gap 16 px; mobile gutters 16 px.
- **Buttons:**
  - primary: Violet background, white text
  - secondary: white background, Sand border, Navy text
  - ghost: Violet text
  - destructive: `--bad`
- **Status chips:** `StatusChip tone="ok|warn|bad|info|neutral"`, always icon + label.
  - Pace green = ok, amber = warn, red = bad.
  - Ahead = teal text on white with a Sand border.
- **Colour use:**
  - Lavender only for info banners.
  - Teal only for the logo, icons, "ahead" and progress ring fills.
  - Orange `#ff7614` only as a logo or illustration fill, **never as text** (it fails contrast).
  - Ash only for disabled text. Placeholders use Stone.
- **Logo:** `DgkLogo` SVG: teal ring `#0ec5b0`, letters K `#02693e`, D `#0ec5b0`, G `#ff7614` (serif). `alt="DGK Business Consultancy"`. It's used in the header, sign-in, the PDFs and the PWA icons (generated with `sharp`).
- **Shared components** (Phase 1, then reused everywhere): `DgkLogo`, `StatusChip`, `MetricCard` (label, value, sub-line, tone, optional sparkline), `PageHeader`, `EmptyState`, `ProgressRing`, `PaceChip`, `MinutesText`, `DayStatusBadge`, `EffectPreview`, `RoleSwitcher`, `NotificationBell`.
- Light theme only.
- Run a brand check at the end of each phase: `grep -rn "#[0-9a-fA-F]\{6\}" src --include=*.tsx` must return nothing except the logo SVG and the PDF styles.

---

# 16. Testing strategy
- **pgTAP** (`supabase/tests/NNN_*.sql`, `supabase test db`). One file per rule group. `plan(n)` counts must be exact. Freeze time with `set daymark.test_now`. Cover:
  - every R5.x and C1–C7 rule
  - RLS (§14)
  - job idempotency
  - the capacity race: two concurrent approvals for the last spot, simulated with `dblink` or two sessions if available; otherwise test the lock plus the constraint trigger
  - cache = compute
  - the retention purge SQL part
- **Must-have edge cases:**
  - clock-in at 06:59:59 (rejected) and 19:00:00 (allowed)
  - distance 199.9 m (ok) vs 200.1 m (rejected)
  - closure day
  - Saturday
  - a second `shift_in` without a `shift_out`
  - the 29- vs 30-minute gap break rule
  - raw exactly 300 (no break) vs 301
  - worked 610 (10 min over maximum)
  - an unscheduled shift becoming all pending overtime
  - partial overtime approval, then a punch fix lowering overtime below the approved amount
  - auto-close when the clock-in is after the scheduled end
  - sick leave 2 days late (ok) vs 3 days (rejected)
  - a swap onto a date at 3 (→ extra spot) and at 4 (rejected)
  - capacity changing between the supervisor and admin steps
  - a pattern change that would create a 5th on one date (rejected, listing the dates)
  - an extension regenerating days
  - a closure day added after generation cancelling a day (not owed)
  - fortnight index before the anchor
  - forecast with no history (ratio 1.0), with the ratio clamped at 0.2, and with no pattern (null)
  - the catch-up option not fully covering the balance
  - the last admin can't be removed
- **Vitest.** Every `src/lib` helper (Darwin time, minutes formatting, periods, zod schemas mirroring the SQL validators) and every component with logic: the ClockCard state machine (all states), the request form preview, RoleSwitcher, KPI cards and the Approve sheet (partial minutes).
- **Playwright e2e** (local Supabase plus the seed, mobile viewport 390×844 plus desktop). Stub geolocation and camera with Playwright permissions and a fake media stream. Five golden paths:
  1. Intern clocks in and out.
  2. Intern submits a swap → supervisor approves → the schedule updates.
  3. Extra-spot flow through the admin.
  4. Catch-up option B submitted.
  5. Supervisor approves the uni report → the intern downloads the PDF.
- **Accessibility:** run `@axe-core/playwright` on each main screen, **only if** Dilip allows adding it. Otherwise do a manual checklist in the log.

---

# 17. Verification gates (run at the end of **every** phase; paste the output into the log)
```bash
npm run lint
npm run typecheck              # next typegen && tsc --noEmit
npm test                       # vitest run
supabase db reset && npm run test:db
npx playwright test            # from Phase 4 on
GITHUB_PAGES=true npm run build
```
Plus:
- the brand grep (§15)
- a manual smoke test of the new screens in `npm run dev` (port 41731) at 390 px and 1280 px wide, with screenshots saved to `docs/progress/screens/phase-N/`

---

# 18. Definition of done (per phase)
1. Every task in the phase plan is checked off in the log, with a commit SHA.
2. All gates in §17 are green, with output pasted.
3. The reviewer subagent's findings are fixed or explicitly deferred with a reason.
4. `README.md` and `CONTEXT.md` are updated for new terms, and an ADR is added for any hard-to-reverse decision.
5. `docs/releases/phase-N.md` has the release notes and the manual steps for Dilip.

---

# 19. Phases (run in order, in one session)

| # | Phase | Delivers | Exit test |
|---|---|---|---|
| 1 | **Foundation & security** | Execute the existing Phase 1 plan exactly: test harness, Darwin time, `clock_now`, sites/settings/closure days, role flags + last-admin guard, email sign-in, delete secrets and leak RPCs and the local `create-staff` code, new punch rules (no breaks), brand tokens and components, PWA manifest | 42+ Vitest and all pgTAP pass; build passes |
| 2 | **Placements & schedule** | Cohorts, placements (wizard), pattern versions and days, generation (§8.6), capacity (§8.5 + trigger), R5.2.5, CSV import with dry-run, admin placement screens, `must_change_password` flow | Seeded placements generate correct days; capacity race test passes |
| 3 | **Hours engine** | Shifts (§8.1), `compute_day` + `day_results` cache (§8.2), progress (§8.3), forecast (§8.4), risk (§8.8), periods, auto-close / day-close / reconcile jobs, overtime auto-requests | Every R5.4–R5.10 test passes; jobs idempotent; perf budgets hold |
| 4 | **Intern experience** | Notifications (bell, Realtime), Today/ClockCard, Schedule, Progress, work-log gate, who's in today (x/3), read-only banner | e2e path 1 passes on mobile |
| 5 | **Requests & approvals** | All 7 request types, `validate_request` / `preview_request`, state machine, extra spot, escalation job, leave docs bucket, punch fix, catch-up planner (§8.7) | e2e paths 2–4 pass |
| 6 | **Supervisor** | Today board, approvals inbox + sheet, at risk, intern detail, check-ins, Monday summary job + page | Supervisor KPI tests pass |
| 7 | **Admin & KPIs** | Overview KPIs (§12), desk heatmap, placements table, people/sites/closures/settings/audit, `run_job`, perf report | Admin KPI tests pass; `perf.md` within budget |
| 8 | **Completion & retention** | Target reached → confirm/extend/withdraw, read-only mode, uni report and certificate PDFs, exit feedback, reminders on days 0/14/25, `retention-purge` Edge Function + `purge_intern` + cron wiring (local only) | e2e path 5 passes; purge test deletes every row and object for the seeded day-31 intern and nothing else |

After Phase 8:
1. Run the whole-branch review subagent.
2. Fix its findings.
3. Push the branch.
4. Open a **draft PR** to `main` with `gh pr create --draft`. The PR description holds the final report (§22) and the release checklist.
5. **STOP.**

---

# 20. What you must not do
- Weaken, skip or delete a test to make a gate pass.
- Use `now()`, `Date.now()` or `new Date()` for business logic, instead of `clock_now()` or the Darwin helpers.
- Use floats for minutes.
- Add a server runtime feature, or a dynamic route segment.
- Put business rules only in TypeScript.
- Show a 4th capacity option to interns, or allow a 5th anywhere.
- Auto-approve anything.
- Store or display a password.
- Touch the hosted Supabase project, `main` or GitHub Pages (§1.3).
- Delete files outside what the plans specify.
- Use hard-coded colours in components.

---

# 21. Release checklist (for Dilip — write it into the PR; do **not** perform it)
1. **Backup first.** The free plan has no backups: run `supabase db dump` against the hosted project and store it privately. Consider moving to Pro before real interns (daily backups, no pausing).
2. **Real emails.** Replace every placeholder `@daymark.example.com` login email with the person's real email **before** migrating. Sign-in becomes email-based.
3. **Role counts.** Record the role counts before and after (admins ≥ 1).
4. **Custom SMTP.** Confirm custom SMTP is configured in Supabase Auth. The default sender only reaches project team members and is rate-limited, so interns won't get reset emails without it.
5. **Redirect URL.** Set the Auth redirect URL to `https://willi220p-star.github.io/presence-tracker/reset-password`.
6. **Scheduled jobs.** Enable the `pg_cron` and `pg_net` extensions, and set Edge Function secrets (`CRON_SECRET`).
7. **Deploy order.** Run `supabase db push`, then `supabase functions deploy retention-purge`, then delete the remote `create-staff` function.
8. **Merge promptly.** Merge the PR to `main` straight after the push, so the live app matches the database.
9. **Tell the interns:** "Sign in with your email. Set a new password if asked."
10. **Live check.** Clock in once on a real phone at Regus, verify the Today board, then clock out.

---

# 22. Final report format (in the PR body and at the end of `BUILD-LOG.md`)
- What was built, per phase: 3–6 bullets each.
- Migrations added (list), Edge Functions, cron jobs (`pg_cron` or Actions).
- Test totals: Vitest n, pgTAP n, Playwright n. All gate outputs are summarised.
- Perf table (§8.13), actual vs budget.
- Screenshots index.
- **Assumptions made** (every one, with the rule number).
- **Open questions** for Dilip.
- Manual test script: 10 steps Dilip can follow on his phone with the seed users.

---

# 23. Assumptions pre-decided for you (Dilip can override before running)
| # | Decision | Default in this prompt |
|---|---|---|
| A1 | Hosting | Keep GitHub Pages static export + Supabase (ADR 0001) |
| A2 | Scheduled jobs | `pg_cron` + `pg_net`; GitHub Actions only as fallback |
| A3 | Pace "days late" | Calendar days between the planned end and the forecast |
| A4 | Closure day added after scheduling | That day is cancelled and **not owed** (R5.2.5) |
| A5 | Clocking after target reached | Blocked until the supervisor confirms, extends or withdraws |
| A6 | CSV-imported interns' first password | One temporary batch password, change forced at first sign-in |
| A7 | Deletion mechanics | Edge Function `retention-purge` (Storage + Auth Admin API) + SQL purge |
| A8 | Execution | One session, phase-gated, draft PR at the end; no deploy |
| A9 | Extra libraries | `@playwright/test` allowed; `@axe-core/playwright` only if approved |
| A10 | Theme | Light only |

</prompt>
