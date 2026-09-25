-- The service role was missing row privileges on the Daymark tables, so the
-- create-staff function could not read profiles or insert new ones.
grant select, insert, update, delete on table public.daymark_profiles to service_role;
grant select, insert, update, delete on table public.daymark_punches to service_role;
