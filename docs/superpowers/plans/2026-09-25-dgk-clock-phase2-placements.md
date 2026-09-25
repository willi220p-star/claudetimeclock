# Phase 2 plan: placements and schedule

- [ ] 2.1 Test helper `tests.create_intern` (person + placement + Mon–Fri 9–5 pattern). Move tests 005/006 onto it.
- [ ] 2.2 pgTAP 010 + migration: cohorts, placements, patterns, scheduled days, history, notifications, access helpers, RLS, punch `placement_id`, R5.1.1 placement check.
- [ ] 2.3 pgTAP 011 + generation: `generate_days`, `regenerate`, `save_placement`, `set_pattern`, R5.2.1–R5.2.5.
- [ ] 2.4 pgTAP 012 + capacity: `assert_capacity`, the constraint trigger, admin override audit, `capacity_preview`, and the dblink race.
- [ ] 2.5 pgTAP 013 + CSV import with dry run.
- [ ] 2.6 UI (agent): placements table, wizard, detail, cohorts, import.
- [ ] 2.7 Gates, review, release notes, tag.
