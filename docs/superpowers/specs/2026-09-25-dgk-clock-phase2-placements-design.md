# Phase 2 design: placements and schedule

## Data
- Tables: `daymark_cohorts`, `daymark_placements`, `daymark_pattern_versions`, `daymark_pattern_days`, `daymark_scheduled_days`, `daymark_schedule_history`, `daymark_notifications` (created early so every phase can notify).
- `planned_minutes` is a generated column (R5.2.4).
- Constraints:
  - one live day per placement and date (R5.2.3)
  - one live placement per intern
  - supervisor ≠ intern (segregation of duties)
  - pattern-day window, step and length checks (R5.2.1)
- Punches get `placement_id`, stamped from the intern's live placement.

## Functions
- Access: `is_supervisor_of`, `can_view_placement`, `current_placement`, `is_my_supervisor`.
- `private.generate_days(placement, from, to)`: one set-based insert. Each date uses the pattern version in force on that date (R5.2.2, §8.6).
- `private.assert_capacity(site, dates[], allow_extra)`: sorted advisory locks; returns the dates that would need an extra spot and raises on a 5th (§8.5).
- The `daymark_scheduled_days_capacity` constraint trigger re-counts under the same lock. A 5th always raises; a 4th needs `daymark.extra_spot_ok = on` (R5.3.5, R5.3.7).
- `private.regenerate(placement, from, allow_extra)` cancels future `pattern` days and generates again. `set_pattern` uses it, and so will `pattern_change` approval in Phase 5 (§8.6).
- `public.save_placement(jsonb, allow_extra)` is admin only and audited. A 4th spot without confirmation raises with hint `extra_spot` and lists the dates.
- `public.capacity_preview(site, start, end, pattern, exclude)` powers the wizard's conflict view.
- `public.import_placements(rows, temp_password, dry_run)`: per-row verdicts, all or nothing, and one batch password that is never stored (A6).
- A new closure day cancels `scheduled` and `leave` days on that date (not owed) and notifies the intern (R5.2.5; assumption: leave days are cancelled too).
- The R5.1.1 clock check now needs an `active`/`extended` placement, and the site comes from the placement.

## Screens (UI agent)
- `/admin/placements`: table with filters.
- `/admin/placement?id=`: detail and edit.
- The wizard: Intern → Dates & target → Weekly pattern with live planned minutes and a capacity preview → Review.
- `/admin/cohorts`.
- `/admin/import`: CSV dry run, template download, batch password.

## Tests
pgTAP files:
- `010_placements.sql`
- `011_schedule.sql`
- `012_capacity.sql` (includes a dblink race)
- `013_import.sql`

The existing punch tests move to interns that have placements.
