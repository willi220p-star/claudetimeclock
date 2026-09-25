-- §8.2 cache = compute on the seed data, at the real clock (no test time).
begin;
select plan(2);
select ok((select count(*) > 0 from public.daymark_day_results), 'the seed produced day results');
select is((select count(*)::int from public.daymark_day_results r
           where to_jsonb(r) - 'computed_at'
                 is distinct from to_jsonb(private.compute_day(r.placement_id, r.work_date)) - 'computed_at'),
  0, 'cache = compute for every seeded day');
select * from finish();
rollback;
