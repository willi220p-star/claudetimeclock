-- Phase 5 test helpers (requests). Committed on purpose, like 000_setup.sql, so 041–049 can use
-- them; kept in its own file so Phase 3's edits to 000_setup.sql don't collide.

-- An unsaved request row for the intern's placement (created_at null = "asked now").
create or replace function tests.draft(
  p_intern uuid,
  p_type text,
  p_payload jsonb,
  p_reason text default 'Covering a family commitment that day'
)
returns public.daymark_requests
language sql
as $$
  select jsonb_populate_record(null::public.daymark_requests, jsonb_build_object(
    'placement_id', private.current_placement(p_intern), 'intern_id', p_intern,
    'type', p_type, 'payload', p_payload, 'reason', p_reason, 'dates', '{}'::date[]));
$$;

-- The server verdict for a draft: 'ok', 'ok +extra' (needs an extra spot) or the message.
create or replace function tests.verdict(
  p_intern uuid,
  p_type text,
  p_payload jsonb,
  p_reason text default 'Covering a family commitment that day'
)
returns text
language sql
as $$
  select coalesce(v.message, 'ok') || case when v.ok and v.needs_extra_spot then ' +extra' else '' end
  from private.validate_request(tests.draft(p_intern, p_type, p_payload, p_reason)) v;
$$;

-- The intern's live scheduled (or leave) day on a date.
create or replace function tests.sday(p_intern uuid, p_date date)
returns uuid
language sql
as $$
  select d.id from public.daymark_scheduled_days d
  where d.placement_id = private.current_placement(p_intern) and d.work_date = p_date
    and d.status in ('scheduled', 'leave');
$$;

-- A trusted system punch at a given instant (fixtures without the device flow).
create or replace function tests.punch(p_intern uuid, p_event text, p_at timestamptz, p_source text default 'auto_close')
returns uuid
language sql
as $$
  insert into public.daymark_punches (user_id, event_type, occurred_at, source)
  values (p_intern, p_event, p_at, p_source)
  returning id;
$$;

-- Create a request as the intern through the public RPC; returns its id.
create or replace function tests.ask(
  p_intern uuid,
  p_type text,
  p_payload jsonb,
  p_reason text default 'Covering a family commitment that day'
)
returns uuid
language plpgsql
as $$
declare
  saved jsonb;
begin
  perform tests.as_person(p_intern);
  saved := public.create_request(p_type, p_payload, p_reason);
  perform set_config('role', 'postgres', true);
  return (saved ->> 'id')::uuid;
end;
$$;

-- Decide a request as a person through the public RPC; returns the new status.
create or replace function tests.decide(
  p_person uuid,
  p_request uuid,
  p_decision text,
  p_note text default null,
  p_minutes integer default null
)
returns text
language plpgsql
as $$
declare
  saved jsonb;
begin
  perform tests.as_person(p_person);
  saved := public.decide_request(p_request, p_decision, p_note, p_minutes);
  perform set_config('role', 'postgres', true);
  return saved ->> 'status';
end;
$$;

create or replace function tests.status(p_request uuid)
returns text
language sql
as $$
  select status from public.daymark_requests where id = p_request;
$$;

grant execute on all functions in schema tests to anon, authenticated;

select plan(1);
select has_function('tests', 'verdict', array['uuid', 'text', 'jsonb', 'text'], 'request test helpers are installed');
select * from finish();
