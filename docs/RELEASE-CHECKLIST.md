# DGK Clock release checklist

This is for Dilip. The build doesn't do any of it: every step touches the live Supabase project (`lnagrfdbmwtlymhumepc`), GitHub or real people. Work through it in order and tick each box.

It adapts build prompt §21 to the decisions in the program design (repo `willi220p-star/claudetimeclock`, site path `/claudetimeclock`, no PDFs, no office code, no MFA yet), and adds the dashboard and infrastructure items from the security review (§4.1, §4.2 and §6).

Plan about two hours, on a day with no interns in the office.

## A. Before you change anything

1. [ ] **Back up the live database.** The free plan has no backups.
   ```bash
   supabase login
   supabase link --project-ref lnagrfdbmwtlymhumepc
   supabase db dump -f dgk-before-release.sql
   supabase db dump --data-only -f dgk-before-release-data.sql
   ```
   Keep both files somewhere private (not in this repo, not in email). Delete them within 30 days (see step 32).
2. [ ] **Think about Supabase Pro ($25 a month) before real interns start.** Pro gives daily backups and the project never pauses. On the free plan the project pauses after 7 days of low activity, and nothing restores a lost hours record. (Review §4.1.)
3. [ ] **Check the region.** Dashboard → Project Settings → General. It should say Oceania (Sydney). The region can't be changed in place. If it's somewhere else, stop here and decide: move to a new Sydney project first (then the URL and key in `.github/workflows/pages.yml` and `.env.example` change), or go live and note it. The collection notice doesn't promise Sydney today. (Review §2.1, §4.1.)
4. [ ] **Give every person their real email.** Sign-in becomes email-based. In the current live app's admin desk, save a real email for each person. Then check none are left:
   ```sql
   select count(*) from auth.users where email ilike '%@daymark.example.com';   -- must be 0
   ```
5. [ ] **Record the role counts.**
   ```sql
   select role, count(*) from public.daymark_profiles group by role;
   ```
   Write the numbers down. You'll compare them in step 22.
6. [ ] **Make the cron secret.** Run `openssl rand -hex 32` and keep the value in your password manager. You'll use it twice, in steps 16 and 19. Never put it in the repo or in a `cron.job` command.
7. [ ] **Prepare the breach plan (review §6).** Name a deputy (one supervisor) and a technical helper. Draft three short templates now: the email to an intern, the email to a university coordinator, and the fields of the OAIC statement. Know the first moves: disable the account, sign everyone out, rotate the Supabase keys, export the logs.

## B. Supabase dashboard settings

8. [ ] **Custom SMTP.** Authentication → Emails → SMTP settings. Use a sender on your own domain with SPF, DKIM and DMARC set up. The default sender only reaches project team members and is rate-limited, so interns won't get reset emails without this. Then look over Authentication → Rate limits.
9. [ ] **Site URL and redirect URL.** Authentication → URL Configuration:
   - Site URL: `https://willi220p-star.github.io/claudetimeclock/`
   - Redirect URLs: add `https://willi220p-star.github.io/claudetimeclock/reset-password/` (keep the trailing slash).
   - Remove the old `…/presence-tracker/…` entries.
10. [ ] **Turn off public sign-ups.** Authentication → Sign In / Providers → turn off "Allow new users to sign up". Keep "Confirm email" on.
11. [ ] **Minimum password length 12.** Authentication → Sign In / Providers → Email → Password requirements. The app already asks for 12–72 characters. Leaked-password protection needs Pro; turn it on if you upgrade.
12. [ ] **Sessions.** Leave the JWT expiry at 1 hour and refresh token reuse detection on (the defaults).
13. [ ] **CAPTCHA (Cloudflare Turnstile) on sign-in and reset: not yet.** Authentication → Bot and Abuse Protection. Don't switch it on with this release: the app doesn't send a CAPTCHA token yet, so every sign-in and reset would fail. It needs a small app change first (a Turnstile widget on `/` and `/reset-password`, plus the Cloudflare domain in the CSP). Ask for that change, then come back to this step.
14. [ ] **API exposure.** Project Settings → Data API → Exposed schemas: `public` (and `graphql_public` only if needed). Never `private`. If nothing uses GraphQL, you can turn off `pg_graphql` in Database → Extensions.
15. [ ] **Extensions.** Database → Extensions: turn on `pg_cron` and `pg_net`.
16. [ ] **Vault secrets for the cron jobs.** SQL editor:
   ```sql
   select vault.create_secret('https://lnagrfdbmwtlymhumepc.supabase.co', 'project_url');
   select vault.create_secret('<the value from step 6>', 'cron_secret');
   ```
17. [ ] **Database settings.** Check SSL enforcement and network restrictions under Database → Settings, if your plan offers them.

## C. Deploy

Do steps 18–21 in one sitting so the live app and the database match.

18. [ ] **Push the database.**
   ```bash
   supabase db push --dry-run    # read the list of migrations it will apply
   supabase db push              # no --include-seed: the seed is test people only
   ```
19. [ ] **Deploy the Edge Function and its secret.**
   ```bash
   supabase secrets set CRON_SECRET=<the value from step 6>
   supabase functions deploy retention-purge
   ```
   `supabase/config.toml` turns off the JWT check for this function. It checks the `x-cron-secret` header instead.
20. [ ] **Delete the old `create-staff` function.**
   ```bash
   supabase functions delete create-staff
   ```
21. [ ] **Publish the app.** In GitHub, `willi220p-star/claudetimeclock` → Settings → Pages → Source: GitHub Actions. Then merge the pull request to `main` straight after the database push. The Pages workflow builds and publishes <https://willi220p-star.github.io/claudetimeclock/>. Watch the Actions tab until it's green.

## D. Check the live system

22. [ ] **Role counts after.**
   ```sql
   select count(*) filter (where is_admin and active)      as admins,
          count(*) filter (where is_supervisor and active) as supervisors,
          count(*) filter (where is_intern and active)     as interns
   from public.daymark_profiles;
   ```
   Admins must be at least 1. Old `staff` logins become interns, so supervisors show 0 at first. In Admin → People, tick Supervisor for each supervisor, and untick Intern for anyone who isn't one.
23. [ ] **Force new passwords.** The old app kept passwords in plain text, so treat them as leaked (review §4.1). In Admin → People, set a new temporary password for each existing person. The app never shows it again and asks them to choose their own at next sign-in.
24. [ ] **Set up placements.** An intern without a placement sees "You don't have a placement yet." Create one for each current intern with the placement wizard, or with Admin → Import (dry run first). Check the NT closure days for 2026–2027 are there, and add office closures such as the Regus Christmas shutdown.
25. [ ] **The test clock is off.** In the SQL editor:
   ```sql
   select coalesce(current_setting('daymark.e2e_clock', true), '') as e2e_clock,
          coalesce(current_setting('daymark.test_now', true), '')  as test_now;   -- both empty
   select setconfig from pg_db_role_setting;                                     -- no daymark.* entries
   ```
   If either is set, reset it with `alter database postgres reset …` before anything else.
26. [ ] **Cron jobs are there.** `select jobname, schedule, active from cron.job order by 1;` should list, all active (UTC; Darwin is +9:30):
   `daymark-auto-close` `35 9 * * *` (7:05 pm), `daymark-day-close` `40 9 * * *` (7:10 pm), `daymark-escalate` `0 * * * *` (hourly),
   `daymark-reconcile` `30 16 * * *`, `daymark-retention-reminders` `31 16 * * *`, `daymark-clock-guard` `32 16 * * *`
   and `daymark-retention-purge` `33 16 * * *` (2:00–2:03 am). The purge command reads its secret from Vault; no command contains it.
27. [ ] **The purge refuses strangers.** Calling `retention-purge` without the header returns 403:
   ```bash
   curl -i -X POST https://lnagrfdbmwtlymhumepc.supabase.co/functions/v1/retention-purge
   ```
28. [ ] **Security Advisor is clean.** Dashboard → Advisors → Security Advisor. Fix or understand every warning before real interns sign in. Run it again after any later migration.
29. [ ] **Storage.** Storage → Buckets: `daymark-photos` and `daymark-leave-docs` are private, with no public URLs.
30. [ ] **No secret keys in the site.** Search the published site's source for `service_role` and `sb_secret_`. Neither may appear.

## E. Privacy

31. [ ] **Fill in your contact details in the collection notice.** Notice v1.0 ends with "Contact Dilip Sapkota at DGK Business Consultancy" but no email or phone. Publish v1.1 with both (Admin → Settings → Collection notice, or `public.publish_notice`). If step 3 confirmed Sydney, you can say so in the same version. Publishing a new version makes every intern read it and choose again before their next clock-in, so do it before go-live, not after.
32. [ ] **Raising the retention period needs a new notice.** The notice promises deletion 30 days after a placement ends. If you ever change `retention_days`, publish a new notice version first.
33. [ ] **Keep your own backups inside 30 days.** The notice promises deletion 30 days after a placement ends. Any copy you keep (database dumps, exported photos) must rotate within 30 days, or the promise breaks. Delete the step 1 dumps once you're happy with the release. (Review §4.1, ADR 0003.)
33. [ ] **Send the notice 14 days ahead.** Put the collection notice in each placement offer email, so interns see it before day one. (Review §2.4.)

## F. Go live

34. [ ] **Tell the interns:** "Sign in with your email. Set a new password if asked."
35. [ ] **Live check at Regus.** On a real phone at the office: sign in as an intern, give consent, clock in with the selfie, check the Today board as a supervisor, then clock out. Also try once from outside the building to see the distance message.
36. [ ] **Turn off the old site.** In `willi220p-star/presence-tracker` → Settings → Pages, unpublish it, so only one app talks to the database.

## G. Later (not needed for go-live)

37. [ ] **Move hosting for real security headers.** GitHub Pages can't send headers, so there's no clickjacking protection, HSTS or `Permissions-Policy`. Cloudflare Pages (free) with a `_headers` file fixes that. The headers to send are in review §4.2.
38. [ ] **MFA for supervisors and the admin (deferred, D5).** TOTP enforced by `aal2` policies needs an app change. It's an open question for you.
39. [ ] **CAPTCHA** once the app change in step 13 is done.
40. [ ] **GitHub hardening (review §4.2).** Turn on Dependabot alerts, secret scanning with push protection, and branch protection on `main`. Pinning the workflow's Actions to commit SHAs is a small code change for a later pull request.
41. [ ] **Your own accounts.** Turn on MFA for your Supabase, GitHub and email logins.
42. [ ] **Breach drill.** Once a year, run a 30-minute tabletop test of the step 7 plan, for example "a selfie link was posted in a group chat". (Review §6.)
