# 0003 Permanent deletion 30 days after a placement ends

Status: accepted (2026-09-25)

## Context
DGK holds selfies, GPS points and sometimes medical certificates. The collection notice promises deletion. Universities keep their own copy of the approved hours report.

## Decision
- On `ended_on + retention_days` (30), everything about the intern is permanently deleted: Storage objects via the Storage API, database rows in FK-safe order in one transaction, then the Auth user via the Admin API. The audit row keeps only a hash of the id, the counts and the date.
- Medical certificate files are deleted 7 days after the leave decision. Only the "sighted" fact stays.
- The intern keeps read-only access until deletion, and gets reminders on days 0, 14 and 25.
- The work runs in the `retention-purge` Edge Function, called nightly by `pg_cron` + `pg_net` with a shared secret header.

## Consequences
Nothing can be recovered after the purge. Dilip's own off-site backups must rotate within 30 days for the promise to hold.
