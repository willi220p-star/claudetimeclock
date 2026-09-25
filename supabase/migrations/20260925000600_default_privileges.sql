-- Phase 1: objects created from now on are closed by default (security review §4.1).
-- Every table and function then grants exactly what it needs, as the earlier migrations do.

alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke all on functions from anon;
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
