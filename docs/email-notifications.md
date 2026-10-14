# Email notifications

DGK Clock can email a notification as well as showing it in the app and as a push. Email goes out through a personal Gmail account via a Google Apps Script web app.

- **Contract:** `docs/superpowers/specs/2026-10-14-email-notifications-contract.md` (D50).
- **Apps Script setup:** `apps-script/README.md`.

## How it fits together

```
private.notify(...)                         (any feature that notifies someone)
  └─ INSERT daymark_notifications           (in-app + push, unchanged)
       └─ AFTER INSERT trigger private.queue_email()
            only if email_enabled, kind in email_kinds,
            person active, not kiosk, email_opt_out = false
            └─ INSERT daymark_email_outbox  status = pending  (id = event_id)

pg_cron "daymark-send-email" (every minute)
  └─ private.call_send_email()
       ├─ processing > 10 min  →  uncertain (stale_processing)
       └─ if a row is due and sent_today < cap:
            net.http_post  <project_url>/functions/v1/send-email   (x-cron-secret)

Edge Function send-email (Supabase, Deno)
  ├─ private.email_claim(20)  →  rows now 'processing'
  ├─ per row: build payload, HMAC-SHA-256 sign with APPS_SCRIPT_SHARED_SECRET
  └─ POST {v, ts, event_id, payload, sig}  →  APPS_SCRIPT_WEB_APP_URL (/exec)

Apps Script web app (runs as the Gmail account)
  ├─ verify envelope, timestamp (±300 s), signature (constant time)
  ├─ check template, category, recipient, ALLOWED_RECIPIENTS, link prefix
  ├─ lock, check CacheService sent:<event_id> (6 h), check quota
  ├─ MailApp.sendEmail(...)
  └─ JSON {ok, event_id, status | code, retryable}

Edge Function  →  private.email_mark(id, sent | retry_pending | failed | uncertain | skipped)
```

The safeguards:
- email is **off** by default;
- the test recipients list in Settings, and `ALLOWED_RECIPIENTS` in Apps Script, limit who can get email;
- the daily cap is 80 per Darwin day.

## End-to-end manual verification

Do these in order. Steps 1 to 4 are one-off setup.

1. **Apps Script is set up.** Follow `apps-script/README.md` steps 1 to 4:
    - Script Properties set, with `ALLOWED_RECIPIENTS` = your address;
    - `setup()` authorised;
    - deployed as a web app, with access **Anyone**.
2. **Supabase secrets are set.** Go to Dashboard → Edge Functions → Secrets. `APPS_SCRIPT_WEB_APP_URL`, `APPS_SCRIPT_SHARED_SECRET` and `APP_BASE_URL` are present, and `CRON_SECRET` already exists.
3. **The migration and function are deployed.** Check that `daymark_email_outbox` exists and the `send-email` function is listed under Edge Functions.
4. **The cron job exists.** In the SQL editor:
    ```sql
    select jobname, schedule, active from cron.job where jobname = 'daymark-send-email';
    ```
5. **Turn on test mode.** In DGK Clock, go to Settings → Notifications → Email:
    - add only your address as a test recipient;
    - set the daily cap to 5;
    - turn email **on**.
6. **Make a notification.** Do something that notifies you, such as posting an announcement or deciding one of your requests.
7. **A row is queued.** In the SQL editor:
    ```sql
    select id, kind, template_id, recipient_category, status, attempts,
           error_code, created_at, processing_at, completed_at
    from daymark_email_outbox
    order by created_at desc
    limit 10;
    ```
    A new row should show `pending`, and within a minute `processing`, then `sent`.
8. **Check the Edge Function logs.** Dashboard → Edge Functions → `send-email` → Logs. There should be one JSON line for the row, with its `event_id` and `status: sent`. No email addresses, secrets or signatures should appear.
9. **Check Apps Script Executions.** Open the script, then **Executions** in the left sidebar. There should be a completed `doPost`, and the log should have the same `event_id` with `"status":"sent"`.
10. **Check the mailbox.** The email arrives. Check:
    - the subject is `DGK Clock: <title>`;
    - the "Open DGK Clock" button goes to the right page in the app;
    - the footer mentions turning it off on Me.
11. **Check the safeguards.** Make a notification for someone **not** on the test list. Their row should end as `skipped` with `not_test_recipient`, and no email goes out. Then turn off "Email me notifications" on your own Me page and trigger another notification. No outbox row should be created.
12. **Check settings and retry.** Settings shows "sent today" with the right count. To force a failure, temporarily change `SHARED_SECRET` in Apps Script, then trigger a notification:
    - the row ends `failed` with `bad_signature` and appears under "Failed and uncertain";
    - restore the secret and click **Retry**;
    - the row goes to `sent`.

Go live only when all twelve steps pass:
- clear the test recipients;
- delete `ALLOWED_RECIPIENTS` in Apps Script;
- set the cap back to 80.

## Troubleshooting

| What you see | Where | Likely cause and fix |
|---|---|---|
| No outbox row | SQL | Check these in order: email is off; the kind isn't ticked; the person opted out, is a kiosk or is inactive. |
| Row stays `pending` | SQL, `cron.job_run_details` | The cron job is missing or inactive, the Vault `project_url`/`cron_secret` are wrong, or the daily cap was reached (it waits until 00:00 Darwin). |
| Edge Function returns 500 "not configured" | Function logs | One of the `APPS_SCRIPT_*` or `APP_BASE_URL` secrets is missing. |
| `failed` with `bad_signature` | Outbox | The secrets differ between Supabase and Apps Script. Paste the same value into both. |
| `failed` with `stale_request` | Outbox | The clocks differ by more than 5 minutes. This is rare; check the request wasn't delayed. |
| `failed` with `recipient_not_allowed` | Outbox | `ALLOWED_RECIPIENTS` is still set in Apps Script. |
| `failed` with `invalid_url` | Outbox | `APP_BASE_URL` doesn't match `ALLOWED_URL_PREFIX`. |
| `failed` with `no_email` | Outbox | The person has no email address in auth. |
| `skipped` with `not_test_recipient` | Outbox | Test recipients are set. This is expected while testing. |
| `retry_pending` with `quota_exceeded` | Outbox | The Gmail quota is used up. It retries with backoff. |
| `retry_pending` with `bad_response` | Outbox | Apps Script returned HTML, usually a login page because access isn't **Anyone**, or the URL is `/dev` rather than `/exec`. |
| `uncertain` with `timeout_uncertain` or `stale_processing` | Settings → Failed and uncertain | The email may or may not have gone. Check the mailbox or Executions before you click Retry. |
| A code change has no effect | Apps Script | Deploy → Manage deployments → Edit → **New version**. |

## Manual actions only Dilip can do

These need Dilip's Google or Supabase login. Nothing in the repo can do them.

1. Choose the sending Gmail account, and sign in to <https://script.google.com> with it.
2. Create the Apps Script project, paste in the three files, and set the Script Properties.
3. Generate `SHARED_SECRET` with `openssl rand -base64 48`. **Never paste it into chat.**
4. Run `setup()` and approve "Send email as you", via the "Google hasn't verified this app" → Advanced → Go to (unsafe) screen.
5. Deploy the web app (Execute as Me, access Anyone), and copy the `/exec` URL.
6. Add the Supabase Edge Function secrets `APPS_SCRIPT_WEB_APP_URL`, `APPS_SCRIPT_SHARED_SECRET` and `APP_BASE_URL`.
7. Apply the migration and deploy the `send-email` Edge Function, if that isn't done by CI.
8. Run the 12-step verification above.
9. Go live: clear the test recipients, remove `ALLOWED_RECIPIENTS`, and set the cap.
10. After any later change to `apps-script/`: paste the new code, then Deploy → Manage deployments → Edit → New version.

## Limitations

- **Delivery is not exactly-once.** Apps Script remembers each sent `event_id` for 6 hours, which catches quick retries.
- If the Edge Function times out after Gmail already accepted the email, the row becomes `uncertain`, and it is not retried automatically.
- A personal Gmail account allows about 100 recipients a day, so the app caps itself at 80.
