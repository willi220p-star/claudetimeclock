# DGK Clock email sender (Google Apps Script)

This folder is a small Google Apps Script web app that sends DGK Clock notification emails from a Gmail account.

The Supabase Edge Function `send-email` POSTs a signed JSON request here. The script:
1. checks the HMAC signature and timestamp;
2. checks the template, the recipient and the link;
3. sends one email with `MailApp`;
4. answers with JSON (`sent`, `duplicate`, or an error code).

Supabase keeps the real record of what was sent, in the `daymark_email_outbox` table. The contract is `docs/superpowers/specs/2026-10-14-email-notifications-contract.md`, and the whole-system guide is `docs/email-notifications.md`.

| File | What it is |
|---|---|
| `Code.js` | `doPost`, request checks, sending, `setup()` and `selfTest()` |
| `Templates.js` | The 6 email templates and `render()` (HTML escaping) |
| `appsscript.json` | Manifest: Darwin time zone, V8, web app settings, minimal scopes |
| `*.test.js` | Vitest tests (`npx vitest run apps-script`). Don't copy these to Apps Script. |

## 1. Create the project

1. Sign in to the Google account that should send the emails. Emails come **from this account**.
2. Go to <https://script.google.com> and click **New project**. This makes a standalone project, not one tied to a Sheet.
3. Click **Untitled project** at the top and rename it to `DGK Clock email`.
4. In the **Files** list, rename `Code.gs` if needed, then replace all its contents with the contents of `apps-script/Code.js`.
5. Click **+** next to Files, then **Script**, and name it `Templates`. Apps Script adds `.gs`. Paste in the contents of `apps-script/Templates.js`.
6. Open **Project Settings** (the gear icon) and tick **Show "appsscript.json" manifest file in editor**. Go back to the **Editor**, open `appsscript.json`, and replace its contents with `apps-script/appsscript.json`.
7. Click **Save** (the disk icon).

The `if (typeof module !== 'undefined')` line at the end of each file is for the tests. Apps Script ignores it.

## 2. Script Properties

Open **Project Settings**, then **Script Properties**, then **Add script property**.

| Property | Required | Value |
|---|---|---|
| `SHARED_SECRET` | Yes | A long random string. It must be the same value as the Supabase secret `APPS_SCRIPT_SHARED_SECRET`. |
| `ALLOWED_RECIPIENTS` | No | A comma list of addresses, such as `you@gmail.com,tester@gmail.com`. While it's set, every other address is refused with `recipient_not_allowed`. Use it while testing, then delete it. |
| `SENDER_NAME` | No | The "From" name. The default is `DGK Clock`. |
| `ALLOWED_URL_PREFIX` | No | Links in emails must start with this. The default is `https://willi220p-star.github.io/claudetimeclock/`. |

**Generating `SHARED_SECRET`.** On a Mac, open Terminal and run:

```sh
openssl rand -base64 48
```

Copy the output into the Script Property, and into the Supabase secret in step 5. Treat it like a password:
- never paste it into a chat, an email, a ticket or a commit;
- if it leaks, generate a new one and update both places.

## 3. Run `setup()` to authorise

1. In the editor, pick `setup` from the function list next to **Run**, then click **Run**.
2. Google asks for permission. Click **Review permissions** and choose your account.
3. You'll see **"Google hasn't verified this app"**. That's normal for a personal script that only you use, because Google hasn't reviewed it. Click **Advanced**, then **Go to DGK Clock email (unsafe)**. "Unsafe" here means "unreviewed". You wrote and pasted the code yourself.
4. The permission screen asks for two things:
    - **Send email as you** (`script.send_mail`). This is the permission the app needs.
    - **See your primary email address** (`userinfo.email`). Only `selfTest()` uses it, to find your own address.

    The script can't read, delete or search your mail. Click **Allow**.
5. The **Execution log** shows `Remaining daily email quota: N`.

**Optional:** run `selfTest()` once. It sends one test email to your own address (`Session.getEffectiveUser().getEmail()`). It doesn't need `SHARED_SECRET`.

## 4. Deploy as a web app

1. Click **Deploy**, then **New deployment**.
2. Click the gear next to "Select type" and pick **Web app**.
3. Fill it in:
    - **Description:** `v1`;
    - **Execute as:** **Me**;
    - **Who has access:** **Anyone**. The Edge Function has no Google login, so the HMAC signature is the access control.
4. Click **Deploy**, then copy the **Web app URL**. It ends in `/exec`.

## 5. Set the Supabase secrets

In the Supabase Dashboard, go to **Edge Functions**, then **Secrets**, and add:

| Secret | Value |
|---|---|
| `APPS_SCRIPT_WEB_APP_URL` | The `/exec` URL from step 4 |
| `APPS_SCRIPT_SHARED_SECRET` | The same value as the `SHARED_SECRET` Script Property |
| `APP_BASE_URL` | `https://willi220p-star.github.io/claudetimeclock` |

`CRON_SECRET` is already set, because push notifications use it.

## 6. Updating the code later

Saving in the editor does **not** change what the `/exec` URL runs. After you paste new code:

1. Click **Deploy**, then **Manage deployments**.
2. Select the deployment and click the pencil (**Edit**).
3. Under **Version**, choose **New version**, then click **Deploy**.

The URL stays the same. If you add a new permission scope, run `setup()` again to re-authorise.

## Quotas

- A consumer Gmail account can send to about **100 recipients a day**. Workspace accounts get more.
- DGK Clock caps itself at **80 a Darwin day** (`email_daily_cap` in Settings). Anything over the cap waits in Supabase and goes out after midnight Darwin time.
- If Google's quota is used up anyway, the script answers `quota_exceeded`, and Supabase retries later.

## Sender identity

- Emails come from the Google account that deployed the script. The "From" name is `SENDER_NAME`.
- To send from another address, add it in Gmail first (**Settings**, then **Accounts**, then **Send mail as**). This script doesn't set `from`, so the account's main address is used.
- In a Google Workspace domain, an admin policy may block **Anyone** access to web apps. If it does, deploy from a personal Gmail account instead.

## Troubleshooting

Look in the Apps Script **Executions** page (left sidebar) and the Supabase `send-email` function logs. Logs show only `event_id`, `template_id`, `category`, `status` and `code`.

| Symptom or code | Cause | Fix |
|---|---|---|
| `bad_signature` | `SHARED_SECRET` and `APPS_SCRIPT_SHARED_SECRET` differ, or one has a trailing space or newline. | Paste the same value into both, then redeploy the Edge Function if needed. |
| `stale_request` | The request was more than 5 minutes old or ahead. | This is almost always a retry of an old request. Check that the Edge Function isn't queueing requests. |
| `server_misconfigured` | `SHARED_SECRET` isn't set. | Add the Script Property. |
| `recipient_not_allowed` | `ALLOWED_RECIPIENTS` is set, and this address isn't on it. | Add the address, or delete the property when you've finished testing. |
| `invalid_url` | The link doesn't start with `ALLOWED_URL_PREFIX`. | Check `APP_BASE_URL` in Supabase and `ALLOWED_URL_PREFIX` here. |
| `quota_exceeded` | The Gmail daily quota is used up. | Wait. Rows retry automatically. Consider lowering the daily cap. |
| `send_failed` | `MailApp` threw an error, often a temporary Google problem. | It retries automatically. If it keeps happening, check Executions. |
| `busy` | Another send held the lock for more than 10 seconds. | It retries automatically. |
| The response is an HTML Google login page, logged as `bad_response` | "Who has access" isn't **Anyone**, or the URL is the `/dev` one. | Edit the deployment: access **Anyone**, and use the `/exec` URL. |
| "Authorization is required" in Executions | Access was revoked, or the scopes changed. | Run `setup()` again and allow. |
| Code changes have no effect | The deployment still runs the old version. | **Manage deployments**, **Edit**, **New version**. |

## Manual test checklist

No curl is needed. Use the app.

1. In Apps Script, set `ALLOWED_RECIPIENTS` to your own address.
2. In DGK Clock, go to **Settings**, then **Notifications**, then **Email**:
    - add your address under test recipients;
    - set a low daily cap;
    - turn email **on**.
3. Do something that notifies you, such as an announcement or a request decision.
4. Within about a minute, the email arrives. Check:
    - the subject `DGK Clock: …`;
    - the button opens the right page;
    - the footer is there.
5. Apps Script **Executions** shows a completed `doPost`, and the log has `"status":"sent"`.
6. Settings shows "sent today" go up by one.
7. Remove `ALLOWED_RECIPIENTS` and the test recipients only when you're ready for everyone to get email.

## Limitations

- **Delivery is not exactly-once.** The script remembers `sent:<event_id>` for 6 hours, so a quick retry is reported as `duplicate`. If the Edge Function times out (20 s) after Gmail accepted the email, Supabase marks the row `uncertain` and **doesn't** retry it automatically. An admin can retry it from Settings, knowing it may already have been sent.
- One email per request. There are no attachments.
