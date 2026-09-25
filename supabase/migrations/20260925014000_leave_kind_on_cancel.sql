-- A leave day cancelled by a closure (R5.2.5) or by the end of a placement keeps its leave kind.
-- Leave days still need a kind; scheduled and moved days still can't have one.
alter table public.daymark_scheduled_days drop constraint daymark_scheduled_days_leave_status_check;
alter table public.daymark_scheduled_days add constraint daymark_scheduled_days_leave_status_check
  check ((status <> 'leave' or leave_kind is not null) and (leave_kind is null or status in ('leave', 'cancelled')));
