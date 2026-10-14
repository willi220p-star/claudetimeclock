# Email notifications through Gmail and Apps Script: contract (D50)

This is the shared interface for the database, Edge Function and Apps Script work.

Dilip's brief asked for Vercel. The app has no Vercel: it is a static GitHub Pages site plus Supabase. So the server-side sender is a **Supabase Edge Function**, copying the push sender (D36): an outbox table, pg_cron every minute, Vault `project_url`/`cron_secret`, and an `x-cron-secret` header.

**Flow:**

`private.notify` writes the `daymark_notifications` row → an AFTER INSERT trigger → a `daymark_email_outbox` row → pg_cron `private.call_send_email()` → Edge Function `send-email` → HMAC-signed POST → Apps Script web app → `MailApp` → structured JSON → `private.email_mark`.

## Decisions (Dilip, 14 Oct)

- **Where it runs:** a Supabase Edge Function, not Vercel.
- **Sender:** a personal Gmail account, which allows about 100 recipients a day. **Daily cap: 80 emails per Darwin day.** Anything over the cap stays `pending` and goes out from 00:00 Darwin the next day.
- **Kinds emailed by default:** `request`, `attendance`, `work_based`, `announcement`, `schedule`, `task`. Admins can change the ticks in Settings.
- **Opt-out:** each person has an "Email me notifications" switch on Me (`email_opt_out`).
- **Safety:** email is **off** until an admin turns it on (`email_enabled = false`). `email_test_recipients`, when not empty, limits sending to those addresses; every other row is `skipped`.
- **Unchanged:** in-app and push notifications.

## Database (migration `20261022010000_email_notifications.sql`, pgTAP `250_email.sql`)

Follow the repo's rules: never `drop` and never `delete from`; renamed or old functions get `*_d49`. RLS is on, there are no grants to authenticated on tables, and everything goes through functions.

**`daymark_settings`** gains these columns:
- `email_enabled boolean not null default false`;
- `email_kinds text[] not null default array['request','attendance','work_based','announcement','schedule','task']`, a subset of `private.push_kind_options()` plus `request`, `attendance`, `work_based`. Reuse the existing kind names. `private.email_kind_options()` returns the allowed list: `request`, `attendance`, `work_based`, `announcement`, `schedule`, `task`, `times`, `signoff`, `digest`, `escalated`;
- `email_test_recipients text[] not null default '{}'`, lower-cased, each one validated to contain `@`;
- `email_daily_cap int not null default 80`, between 1 and 95.

**`daymark_profiles`** gains `email_opt_out boolean not null default false`.

**`daymark_email_outbox`**

| Column | Type and rules |
|---|---|
| `id` | uuid pk default `gen_random_uuid()`. It is the stable **event_id** sent to Apps Script and reused on every retry. |
| `notification_id` | uuid, unique, references `daymark_notifications`, on delete set null |
| `person_id` | uuid, references profiles, on delete cascade |
| `kind` | text |
| `template_id` | text |
| `recipient_category` | `'user'` or `'admin'`. It is `admin` when the person `is_admin` or `is_supervisor`. |
| `title`, `body`, `link` | Snapshot of the notification at insert. `body` is cut to 1,000 characters. `link` keeps the existing notification link check. |
| `status` | `pending`, `processing`, `sent`, `failed`, `retry_pending`, `uncertain` or `skipped` |
| `attempts` | int, default 0 |
| `next_attempt_at` | timestamptz, default now |
| `correlation_id` | uuid, default `gen_random_uuid()` |
| `created_at`, `processing_at`, `completed_at` | timestamptz |
| `error_code` | text, at most 60 characters |
| `error_message` | text, at most 300 characters, sanitised: no secrets, signatures or email addresses |

Indexes: `(status, next_attempt_at)`, and `(completed_at)` where `status = 'sent'`.

**`template_id` by kind and category:**

| Kind | User | Admin |
|---|---|---|
| `request` | `request_update` | `approval_needed` |
| `attendance`, `work_based` | `approval_needed` | `approval_needed` |
| `announcement` | `announcement` | `announcement` |
| `schedule` | `roster_change` | `roster_change` |
| `task` | `task_update` | `task_update` |
| anything else allowed | `general_notice` | `general_notice` |

**Trigger** `private.queue_email()`, AFTER INSERT on `daymark_notifications`. It inserts an outbox row only when all of these are true:
- `email_enabled` is on;
- the kind is in `email_kinds`;
- the person is active, not a kiosk, and has `email_opt_out = false`.

It uses `on conflict (notification_id) do nothing`, so a repeated event never makes a second row.

**`private.call_send_email()`**, run by pg_cron every minute (`daymark-send-email`):
1. Any `processing` row older than 10 minutes becomes `uncertain`, with code `stale_processing`. It is never retried automatically.
2. Only if a row is due does it `net.http_post` to `<project_url>/functions/v1/send-email` with `x-cron-secret`. A row is due when its status is `pending` or `retry_pending`, `next_attempt_at <= now()`, and today's sent count is under the cap. This uses the same Vault secrets as push.

**`private.email_claim(max_rows int)`** is for service_role only (revoke it from authenticated).
- **Claims:** it atomically claims due rows with `for update skip locked`. It takes at most `least(max_rows, cap − sent_today)`, where `sent_today` counts `sent`, `processing` and `uncertain` rows with `processing_at` in today's Darwin date.
- **Updates:** `status = 'processing'`, `processing_at = now()`, `attempts + 1`.
- **Returns per row:** `id`, `correlation_id`, `template_id`, `recipient_category`, `kind`, `title`, `body`, `link`, `created_at`, `attempts`, `recipient_name` (the display name), and `recipient_email` (from `auth.users`, lower-cased, can be null). It also returns `test_only boolean` and `allowed boolean`. `allowed` is false when the test list is not empty and the address isn't on it.

**`private.email_mark(id uuid, status text, error_code text, error_message text)`** is for service_role only.
- It applies only to rows in `processing`. Any other state is a no-op, so `sent` is never overwritten.
- `sent` sets `completed_at`.
- `retry_pending` sets `next_attempt_at = now() + backoff`, where backoff is `2^attempts` minutes plus random jitter of up to 30 s, capped at 60 minutes. After 5 attempts it becomes `failed` with code `max_attempts`.
- `failed`, `uncertain` and `skipped` set `completed_at`.
- It cuts the message to 300 characters.

**Admin RPCs** (private plus a public invoker wrapper, authenticated, `require_admin`, audited):
- `email_settings() returns jsonb`: `{enabled, kinds, options, test_recipients, daily_cap, sent_today, queued, failed_7d, uncertain_7d}`.
- `save_email_settings(enabled boolean, kinds text[], test_recipients text[], daily_cap int) returns void`, validating every field (22023).
- `email_failures(max_rows int default 50)` returns `id`, `created_at`, `kind`, `template_id`, `recipient_category`, `person_name`, `status`, `attempts`, `error_code`, `error_message`, `completed_at`. It lists `failed` and `uncertain` rows from the last 30 days and shows no email addresses.
- `retry_email(id uuid) returns void`: only `failed` or `uncertain` rows go back to `retry_pending` with `next_attempt_at = now()` and `attempts = 0`, so a manual retry gets a fresh set of attempts. Audited.

**Self-service RPC:** `set_my_email(enabled boolean) returns void` sets `email_opt_out = not enabled` for the caller. `my_email_setting() returns boolean`.

**pgTAP 250 must cover:**
- the trigger: enqueues only allowed kinds, only when enabled, skips opt-outs, kiosks and inactive people;
- a duplicate `notification_id` makes no second row;
- category and template mapping;
- the claim respects the cap of 80 and today's date;
- `skip locked`, where possible;
- mark transitions never overwrite `sent`;
- the backoff after 5 attempts gives `failed`;
- stale processing becomes `uncertain`;
- `retry_email` is admin only;
- settings validation;
- `set_my_email`;
- service-role-only functions are not executable by authenticated.

## Signing (Edge Function → Apps Script)

Apps Script `doPost(e)` can't read request headers, so everything goes in the JSON body:

```json
{"v":1,"ts":1760400000,"event_id":"<outbox uuid>","payload":"<JSON string>","sig":"<hex>"}
```

- `payload` is a **string**: the exact JSON text that was signed. Apps Script parses it only after the signature checks out.
- `sig = lowercase hex( HMAC-SHA-256( key = UTF-8 bytes of SHARED_SECRET, message = UTF-8 bytes of "v1." + ts + "." + event_id + "." + payload ) )`.
- `ts` is Unix seconds. Apps Script rejects a request when `|now − ts| > 300`.
- The signature comparison is constant-time.

**Payload JSON:**

```json
{
  "event_id": "...",
  "correlation_id": "...",
  "template_id": "...",
  "recipient_category": "user|admin",
  "to": "...",
  "data": {
    "recipient_name": "...",
    "event_title": "...",
    "event_message": "...",
    "action_url": "...",
    "event_timestamp": "..."
  }
}
```

- `action_url` is `APP_BASE_URL` + the notification `link`, or `APP_BASE_URL` + `/notifications` when there's no link.
- `event_timestamp` is formatted in Darwin time, e.g. "Tue 14 Oct, 9:05 am".

**Apps Script response**, always HTTP 200 JSON:
- Success: `{"ok":true,"event_id":"...","status":"sent"|"duplicate"}`.
- Failure: `{"ok":false,"event_id":"...|null","code":"...","message":"...","retryable":true|false}`.

**Error codes:**
- Permanent (`retryable:false`): `bad_request`, `bad_signature`, `stale_request`, `unknown_template`, `invalid_recipient`, `recipient_not_allowed`, `invalid_url`.
- Temporary (`retryable:true`): `quota_exceeded` (when `MailApp.getRemainingDailyQuota() < 1`), `send_failed`, `busy` (lock timeout).

**How the Edge Function maps outcomes:**
- `ok` with `sent` or `duplicate` → `sent`.
- `ok:false` with `retryable` → `retry_pending`.
- `ok:false` and not retryable → `failed`.
- A timeout (`AbortSignal.timeout(20000)`) → `uncertain`, with code `timeout_uncertain`. Never retried automatically.
- A fetch rejection that is not a timeout → `retry_pending`, with code `network`.
- A non-JSON or malformed body → `retry_pending`, with code `bad_response`.
- `recipient_email` is null → `failed`, with code `no_email`.
- `allowed = false` → `skipped`, with code `not_test_recipient`.

## Edge Function `supabase/functions/send-email/`

- **Files:** `index.ts` (Deno.serve) and `email.ts` (pure logic, with no Deno APIs): building the payload, `canonicalString`, `outcomeFor(response | error)`, `buildActionUrl`, `formatDarwin`. `email.test.ts` runs under Vitest, as `send-push` does.
- **Signing:** HMAC uses Web Crypto (`crypto.subtle`), in a small async `sign()` in `email.ts` that also works under Node 22 in Vitest.
- **Secrets:** `CRON_SECRET` (already set), `APPS_SCRIPT_WEB_APP_URL`, `APPS_SCRIPT_SHARED_SECRET` and `APP_BASE_URL`. If any is missing, it returns 500 "not configured" and claims nothing.
- **Logging:** one JSON line per row with `event_id`, `correlation_id`, `template_id`, `recipient_category`, `attempts`, `status` and `code`. Never the address, secret, signature or body.
- **Batches:** it claims up to 20 rows per run and sends them one after another.

## Apps Script `apps-script/`

- **`Code.js`:** `doPost(e)`, `handle(raw, deps)` with dependency injection for testing, `verify`, and `send` through `MailApp.sendEmail({to, subject, body, htmlBody, name: SENDER_NAME})`.
- **`Templates.js`:** the registry `{id, version, categories, subject, text, html, required}` for the 7 templates, plus `render(template, data)` with HTML escaping and the `action_url` prefix check.
- **Testability:** each file ends with `if (typeof module !== 'undefined') module.exports = {...}`, so Vitest can load them (`apps-script/**/*.test.js`, added to the vitest include).
- **Script Properties:**
    - `SHARED_SECRET` (required);
    - `ALLOWED_URL_PREFIX`, default `https://willi220p-star.github.io/claudetimeclock/`;
    - `SENDER_NAME`, default `DGK Clock`;
    - `ALLOWED_RECIPIENTS`, optional comma list, a second test safeguard.
- **Replay:** after the HMAC and timestamp checks, a `LockService.getScriptLock()` with `tryLock(10000)`. `CacheService.getScriptCache()` keeps `sent:<event_id>` for 6 hours, so a repeat within that window returns `duplicate` without sending. Supabase stays the authoritative record.
- **`README.md`:** setup, authorisation, deployment ("Execute as: Me", "Who has access: Anyone"), updating a deployment version, quotas, and troubleshooting.

## UI

- **Settings → Notifications**, a new "Email" section (admin):
    - an on/off switch, warning "Off until you've tested it";
    - the kinds as ticks;
    - test recipients (one per line), with the hint "While this list has addresses, only they get emails";
    - the daily cap;
    - status: sent today out of the cap, queued, failed and uncertain;
    - a "Failed and uncertain" list with a **Retry** button per row and a confirm for uncertain rows ("It may already have been sent").
- **Me** (interns), and the staff Notifications page: "Email me notifications" switch (`set_my_email`).

## Out of scope

- Vercel.
- Per-kind opt-out per person.
- Attachments.
- Gmail drafts as templates (none exist today).
