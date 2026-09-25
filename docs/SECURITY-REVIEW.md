# DGK Clock: Consent, Privacy and Security Review (NT, Australia, September 2026)

DGK Clock can lawfully collect GPS location and selfies if interns give **express consent** to each one. The biggest real risks are not legal. They are that someone calls the Supabase API directly, spoofs their GPS or clocks in for a friend, and that nobody enforces the rules inside Postgres. Fix those first, then add a separate consent step for each data type.

## TL;DR
- **Law:** DGK is probably exempt from the Privacy Act as a small business, because its turnover is under $3m and holding medical certificates does not make it a "health service provider". That still leaves real obligations. The NT *Surveillance Devices Act 2007* requires express or implied consent before GPS tracking. The new statutory privacy tort applies to every business regardless of size. The "employee records" exemption would not protect DGK anyway, because unpaid placement students are not employees. **Build to full APP standard with separate consent for location, selfie and medical certificate.** Tranche 2 reform (exposure draft released 31 August 2026) will raise the bar again, and universities will expect APP-level handling.
- **Loopholes:** The top risks are (1) rules checked only in the browser, (2) GPS spoofing, (3) buddy punching and photo replay, (4) client-supplied timestamps, and (5) supervisors approving their own or colluding punch-fixes. Countermeasures: move every rule into Postgres, stamp every event with the server's clock, add a rotating office code and a random gesture in the selfie, and enforce segregation of duties in the database.
- **Platform:** On the Supabase free plan you get no backups, and Supabase's production checklist warns it "may pause applications on the Free Plan that exhibit low activity in a 7-day period". There is also no leaked-password check or session time-boxing. Host in Sydney, run your own off-site backups, turn on CAPTCHA and TOTP MFA for supervisors and admin (enforced via `aal2` RLS), and move off GitHub Pages (or put Cloudflare in front) so you can send real security headers.

---

## 1. Executive summary

**Top legal obligations**
1. **NT Surveillance Devices Act 2007, s 13.** Under s 13(1) it is an offence to "install, use or maintain a tracking device to determine the geographical location of a person" without that person's "express or implied consent". The maximum penalty is 250 penalty units or imprisonment for 2 years. The browser Geolocation API reading a phone's location counts as a tracking device use in substance. Get **express, recorded consent** and only read location at the moment of clock-in or clock-out. Never read it in the background.
2. **Privacy Act 1988 (Cth).** DGK is probably exempt as a small business, but the exemption is fragile. It is lost if turnover has exceeded $3m in any financial year since 2001, and university placement agreements often impose APP compliance by contract. The statutory tort for serious invasions of privacy (in force since 10 June 2025) applies to "individuals and other entities that may not necessarily be an APP entity" (OAIC).
3. **Selfies and biometrics.** OAIC's facial recognition guidance treats facial images as **sensitive information "when used for automated verification or identification purposes"**. If DGK never runs face matching, the selfies stay ordinary personal information. Keep it that way. The Kmart determination ([2025] AICmr 155) and the Bunnings matter show the OAIC sets a high bar for automated face matching. However, the Tribunal's February 2026 Bunnings decision found Bunnings could rely on exemptions to the consent requirement, so do not treat this area as settled.
4. **Medical certificates are health information** (sensitive). Minimise them: let a supervisor sight the certificate and tick a box, and make upload optional and short-lived.
5. **Visa holders and placement rules.** A mandatory course placement generally doesn't count toward the 48 hours per fortnight limit for student visa holders *if the course specifies it*. Unpaid placement stays lawful only while it is a course requirement. Once the required hours are met, extra unpaid work risks becoming employment. The app should stop counting hours at the target or end date.

**Top loopholes (likelihood × impact for DGK Clock)**
6. **Rules enforced only in the browser.** The anon key is public, so anyone can POST to the REST/RPC API with any latitude, longitude and timestamp. This is the critical risk.
7. **GPS spoofing.** Android mock-location apps and desktop DevTools sensor overrides make it trivial, and the browser API cannot detect them.
8. **Buddy punching and photo replay.** A friend clocks in with the intern's password, or the intern holds up a photo or screen, or picks an image from the gallery.
9. **Punch-fix and leave abuse, supervisor collusion or self-approval.** This directly inflates the university hours report.
10. **Account takeover of a supervisor or admin.** Causes include no MFA, no leaked-password check on the free plan, an XSS attack stealing the localStorage token, and long-lived storage signed URLs leaking selfies or medical certificates.

---

## 2. Consent pack

### 2.1 Legal basis summary

| Law / instrument | Applies to DGK? | What to do |
|---|---|---|
| Privacy Act 1988 (Cth) + APPs 1, 3, 5, 6, 8, 11, 12, 13 | **Probably not as a matter of law** (small business operator, turnover ≤ $3m, not a health service provider, not trading in personal information). It does apply if turnover ever exceeded $3m, if DGK opts in, or if a university contract requires it. | Comply voluntarily with the APPs in full: notice (APP 5), consent for sensitive information (APP 3.3), use only for stated purposes (APP 6), security and destruction (APP 11), access (APP 12), correction (APP 13). |
| Small business "health service" exception | **No.** Receiving a medical certificate to approve leave is not providing a health service. OAIC's examples are clinicians, counselling, telehealth and disability services. | Still treat certificates as sensitive information. |
| Employee records exemption (s 7B(3)) | **No.** It covers only employees. OAIC says it does not cover volunteers, and FWO says placement students "are not considered to be employees". | Don't rely on it. Give interns full access and correction rights. |
| Statutory tort, serious invasions of privacy (Sch 2, since 10 June 2025) | **Yes, applies to everyone.** Requires intrusion upon seclusion or misuse of information, a reasonable expectation of privacy, intentional or reckless conduct, and seriousness. | Never track location outside clock events. Lock down selfies and medical certificates. Never share them beyond purpose. |
| POLA Act 2024: automated decision transparency (commences **10 December 2026**) | Binding only on APP entities. It is relevant because the app auto-rejects clock-ins that affect counted hours. | Disclose in the privacy policy that the system automatically rejects out-of-geofence or out-of-hours clock-ins, and how to request human review. |
| POLA Act 2024: Children's Online Privacy Code | Unlikely (interns are adults). | If an intern is under 18, get legal advice. |
| Tranche 2: Exposure Draft *Privacy Amendment (Personal Data Protection) Bill 2026* (released 31 August 2026, submissions closed 18 September 2026) | **Not law.** No commencement date. It contains "approximately 40 proposals", including a "fair and reasonable" test and stronger breach duties. Ashurst Perkins Coie and Lexology analyses note it leaves out removal of "the small business and employee records exemptions". | Design to "fair and reasonable" now: minimal collection, proportionate, transparent. |
| NT Surveillance Devices Act 2007: s 13 tracking, optical surveillance | **Yes.** | Get express, recorded consent for location. The intern takes the selfie themselves, so they are a party. Never capture other people's private activities. |
| NT workplace surveillance statute | **None exists.** NT regulates workplace surveillance only through the general Surveillance Devices Act. | Adopt NSW and ACT notice practice voluntarily (below). |
| NSW Workplace Surveillance Act 2005 / ACT Workplace Privacy Act 2011 | **Not binding in NT.** | Best practice: give written notice 14 days ahead covering the kind of surveillance, how it's done, start date, whether continuous or intermittent, whether limited or ongoing, and (ACT) who is surveilled, the purpose, and consultation rights. |
| Information Act 2002 (NT) | Applies to NT public sector organisations, not DGK. | Check whether your university partner is covered (for example an NT statutory university). If so, its placement agreement may pass obligations through to DGK. |
| Fair Work Act 2009 s 12 "vocational placement" | Yes, as context. It stays lawfully unpaid only while it is a course requirement. | Keep the placement agreement. Block clock-ins after the end date or target unless the university confirms an extension. |
| Student visa condition 8105 (48 hours per fortnight) | Affects interns, not DGK directly. | Don't record visa status. Record that the placement is a mandatory course component (university confirmation). Give interns a Monday-start fortnightly hours summary. |
| Notifiable Data Breaches (Part IIIC) | Only mandatory for APP entities, so probably not DGK. | Follow it voluntarily and per your university agreements (Section 6). |
| APP 8 cross-border disclosure | Voluntary standard. | Host Supabase in **Sydney (ap-southeast-2)**. Stop sending coordinates to Nominatim or Google (see rule 12). Disclose that Supabase and GitHub are US companies. |

### 2.2 Draft collection notice (show in full at first sign-in, before any camera or GPS use)

> **How DGK Clock handles your information (Version 1.0, [date])**
>
> DGK Business Consultancy ("DGK", Palmerston City NT) runs DGK Clock to record your placement hours and give your university an accurate, supervisor-approved hours report.
>
> **What we collect and why**
> - **Your details:** name, email, university, course, university coordinator's name and email, and your schedule, so we can run your placement and send reports.
> - **Location (only when you tap Clock in / Clock out):** your phone's GPS position and its accuracy, used once to confirm you are within 200 m of our office at 1 Palmerston Circuit. **We never track you in the background, outside the office, or outside Mon–Fri 07:00–19:00.**
> - **Selfie (only when you tap Clock in / Clock out):** a photo taken live with your phone camera, to confirm it is really you clocking in. Photos are viewed only by your supervisor or the DGK admin, for spot checks or disputes. **We do not use facial recognition or any automated face matching.**
> - **Work logs, weekly supervisor ratings and comments, exit feedback:** to supervise and assess your placement.
> - **Leave requests and (optional) medical certificates:** to approve sick or personal leave. A certificate contains health information. You can show it to your supervisor in person instead of uploading it.
> - **Security records:** an audit log of actions in the app and basic device and network information, to prevent fraud and misuse.
>
> **Who sees it:** you, your assigned supervisor(s), and the DGK admin. Your university receives only the approved hours report and, if your placement agreement requires it, your supervisor's ratings. We use Supabase (database and storage, hosted in Sydney, Australia; Supabase is a US company) and GitHub Pages (website hosting, US). We do not sell or share your information for marketing.
>
> **If you say no:** location and selfie are optional. If you don't consent, your supervisor confirms your attendance in person instead. This will not affect your placement or assessment. Medical certificate upload is always optional.
>
> **How long we keep it:** everything about you, including photos, certificates and backups we control, is **permanently deleted 30 days after your placement ends**. Your university keeps its own copy of the hours report under its own policies.
>
> **Your rights:** you can ask to see or correct your information, withdraw consent at any time (Settings → Privacy), or complain. Contact Dilip Sapkota, [email], [phone]. We'll respond within 30 days. If you're not satisfied, you can contact the Office of the Australian Information Commissioner (oaic.gov.au).
>
> **Automated checks:** the app automatically refuses clock-ins outside the office area or outside hours. If you think a refusal is wrong, ask your supervisor for a manual review.

### 2.3 Draft consent checkboxes (separate, unticked by default, each individually withdrawable)

- ☐ **Location:** "I agree that DGK Clock may read my phone's GPS location **only at the moment I tap Clock in or Clock out**, to check I'm within 200 m of the DGK office. I understand it is not tracked at any other time, and that I can withdraw and use supervisor confirmation instead."
- ☐ **Selfie:** "I agree that DGK Clock may take a live photo of me each time I clock in or out, stored privately and viewed only by my supervisor or the DGK admin to verify attendance. No facial recognition is used. I can withdraw and use supervisor confirmation instead."
- ☐ **Medical certificate (shown only when uploading):** "I agree to DGK storing this medical certificate, which contains health information, only so my supervisor can approve this leave request. It will be deleted [7 days after the decision / 30 days after my placement ends]. I know I can show it in person instead."
- Separately: "I have read the collection notice (v1.0)." This is acknowledgement, not consent. Record it.

### 2.4 When to show what
- **First sign-in:** the full notice, acknowledgement, and the location and selfie choices. Block clock-in until the intern has chosen, either consent or the "supervisor confirmation" path.
- **Just-in-time browser permission:** only call `getUserMedia` or `getCurrentPosition` after the intern taps Clock in, with a one-line pre-prompt ("We'll now ask for camera and location for this clock-in only"). Never request permissions on page load. If the browser permission is denied, show how to re-enable it, or offer supervisor confirmation.
- **Re-consent:** whenever the notice version changes in substance (a new data type, new recipient, new purpose, or longer retention). Bump `notice_version` and force re-display.
- **Medical certificate:** consent on the upload screen each time.
- **14-day advance notice (NSW/ACT best practice):** include the notice in the placement offer email so interns see it before day one.

### 2.5 Privacy policy outline
1. Who we are and contact details. 2. Kinds of information (as in the notice). 3. How we collect it (in-app only; location and selfie only at clock events). 4. Purposes. 5. Sensitive information: health (medical certificates); no biometric processing. 6. Disclosures (university, service providers). 7. Overseas: Supabase (Sydney region, US company), GitHub (US); no geocoding third party. 8. Security measures (summary). 9. Retention and deletion (30 days after placement end; certificate files sooner). 10. Automated decisions (geofence and time-window refusals; human review). 11. Access, correction and withdrawal. 12. Complaints (internal, then OAIC). 13. Data breach response commitment. 14. Version history.

### 2.6 Consent-record data model

```sql
create table public.consent_records (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  purpose       text not null check (purpose in
                 ('collection_notice','location','selfie','medical_certificate','privacy_policy')),
  decision      text not null check (decision in ('granted','refused','withdrawn','acknowledged')),
  notice_version text not null,          -- e.g. '1.0'
  notice_sha256  text not null,          -- hash of the exact text shown
  related_id    uuid,                    -- e.g. leave_request id for a certificate
  recorded_at   timestamptz not null default now(),  -- server time only
  user_agent    text,
  recorded_by   uuid not null default auth.uid()
);
-- Append-only: no UPDATE/DELETE grants; withdrawal = new row.
-- RLS: user can INSERT/SELECT own rows; supervisor/admin SELECT for assigned interns.
-- Current state = latest row per (user_id, purpose).
```
Add a `private.has_consent(uid, purpose)` function. The clock-in RPC calls it, and if consent is absent it routes to the supervisor-confirmation path.

### 2.7 Refusal / alternative process
- **No location or selfie consent:** the intern taps "Request supervisor confirmation" and an event is created with `verification_method = 'supervisor'`. A supervisor who is physically present confirms it the same day. Unconfirmed events count zero hours. The university report shows the method per entry, neutrally.
- **Browser permission denied or GPS failure on the day:** the same fallback, flagged as a one-off.
- **No certificate upload:** the supervisor ticks "certificate sighted in person" with the date. No file is stored.
- The refusal path must carry no penalty. Consent is not voluntary if refusing costs the intern their placement.

### 2.8 Data processing summary for universities (one page)
Purpose; data categories; who has access; hosting (Supabase Sydney, US parent); security (RLS, MFA for supervisors and admin, private storage, audit log); what the university receives; verification method per hours entry; retention (30 days after end); breach notification commitment (notify the coordinator within 72 hours of confirming an incident affecting their student); contact.

---

## 3. Loophole register

| # | Loophole | How it's exploited | L | I | Countermeasure (DB / app / process) | Effort | Residual |
|---|---|---|---|---|---|---|---|
| 1 | Client-side rule enforcement | Curl `POST /rest/v1/clock_events` or RPC with the anon key plus a user JWT, sending fake lat/lng, time, or out-of-sequence events | High | Critical | **DB:** revoke INSERT/UPDATE/DELETE on event tables from `anon` and `authenticated`. Write only via a `clock_in` RPC that computes distance, window, sequence and consent in SQL and sets `occurred_at := now()` | M | Low |
| 2 | GPS spoofing | Android mock-location app; iOS spoofing via computer tools; DevTools "Sensors" override on desktop | High | High | **App/DB:** rotating office code (rule 6) required for GPS events. Flag accuracy ≤ 3 m or ≥ 150 m, identical coordinates repeated across days, impossible travel, desktop user agents. **Process:** weekly flag review. A VPN has no effect on GPS | M | Medium (a colluding person at the office can relay the code) |
| 3 | Buddy punching (shared password) | A friend at the office signs in as the intern | Med | High | Selfie + random gesture (rule 7); supervisor spot checks of 1-in-5 selfies; MFA optional for interns; alert on new-device sign-in | S–M | Low–Medium |
| 4 | Photo or screen replay, gallery upload | Hold a printed photo or phone screen to the camera; pick from the gallery via `<input type=file>` | Med | High | Capture only via a live `getUserMedia` stream (no file input). Server-issued gesture must appear. Selfie object must exist in Storage, be owned by the user, and be created within 3 minutes of the challenge | S | Low–Medium |
| 5 | Virtual camera or injected stream | OBS virtual cam or an emulator on desktop; rooted phone hooks | Low | High | Treat desktop clock-ins as flagged or blocked; gesture challenge; spot checks | S | Low |
| 6 | Device clock and time manipulation | Change the phone clock or send `occurred_at` in the payload | High if trusted | High | Ignore all client times; `occurred_at := now()`. Honour `daymark.test_now` only when `session_user = 'postgres'` and never set it at database level | S | Very low |
| 7 | Replayed requests | Resend a captured clock-in request later | Med | Med | One-time `clock_challenges` nonce, 90-second expiry, `used_at` set atomically; sequence rule (in → out) | S | Very low |
| 8 | Punch-fix / forgot clock-out abuse | Request inflated corrections; supervisor rubber-stamps | High | High | Auto-close open sessions at 19:00 as "unverified, 0 hours". Fixes need a reason, a cap (e.g. 2 per fortnight), and supervisor approval. Fixes are shown separately in the university report | M | Medium |
| 9 | Self-approval / role conflict | A user who is both intern and supervisor, or the admin, approves their own hours or leave | Med | High | **DB constraint:** `approver_id <> subject_user_id`. A dual-role person needs a different supervisor. Admin self-actions are logged and highlighted in the report | S | Low |
| 10 | Supervisor collusion | A supervisor approves fake hours for an intern | Low | High | Admin monthly sample review; report lists approver names and verification method; university coordinator gets per-entry method | S | Medium |
| 11 | Leave abuse / fake certificates | Upload an edited certificate | Med | Med | Supervisor judgement; optional in-person sighting; don't store beyond need. Leave hours never count as placement hours | S | Medium |
| 12 | RLS gaps / SECURITY DEFINER exposure | Table without RLS; view without `security_invoker`; definer function in `public` callable by `anon` | Med | Critical | Security Advisor clean (lints 0010, 0011, 0013, 0023, 0024, 0028, 0029); revoke EXECUTE from `anon` on all functions by default | M | Low |
| 13 | Storage leakage | Long-lived signed URLs forwarded; permissive bucket policy; path guessing | Med | High | Private buckets; signed URLs ≤ 60–300 s; path `{user_id}/{uuid}.jpg`; RLS on `storage.objects` by folder = `auth.uid()` or assigned supervisor | S | Low |
| 14 | Supervisor/admin account takeover | Password reuse, phishing, no leaked-password check on the free plan | Med | Critical | TOTP MFA enforced with a restrictive `aal2` RLS policy; min 12-character passwords; CAPTCHA; custom SMTP; sign-in alerts | S–M | Low |
| 15 | XSS → token theft | Malicious text in a work log, comment or name rendered unsafely (`dangerouslySetInnerHTML`, `javascript:` links, HTML-to-PDF) steals the localStorage session | Low–Med | Critical | No raw HTML rendering; validate URLs; build PDFs from data, not HTML strings; CSP; move to a host with real headers | S–M | Low |
| 16 | Stale access after offboarding | An ex-intern or ex-supervisor keeps a valid refresh token | Med | Med | On end date: `active=false` checked in RLS; an Edge Function bans the user and signs out all sessions | S | Low |
| 17 | Deletion failure (privacy promise broken) | Deleting `storage.objects` rows via SQL orphans files; your own backups keep data > 30 days | Med | High | Delete files via the Storage API; keep a deletion certificate row; off-site backups on ≤ 30-day rotation | M | Low |
| 18 | Test clock abuse | `daymark.test_now` honoured in cron jobs (session_user = postgres) | Low | High | Only `SET LOCAL` in test transactions; nightly check that `current_setting('daymark.test_now', true)` is null in production | S | Very low |
| 19 | Supply chain | Compromised npm package or GitHub Action injects code into the bundle | Low–Med | Critical | Lockfile + `npm ci`; Dependabot; pin Actions to commit SHAs; least-privilege workflow tokens; secret scanning + push protection | S | Low–Medium |
| 20 | Free-plan outage or data loss | Project pauses after 7 days of low activity; no backups | Med | High | Daily off-site `pg_dump` via GitHub Actions (encrypted), plus weekly Storage export; or Pro ($25/month) | S | Low |

L = likelihood, I = impact. Ratings are my judgement for a 3–10 intern office, not measured data.

**Options that don't work well here**
- **Web NFC / Web Bluetooth beacons:** not supported in iOS Safari, so they would exclude iPhone users.
- **Office Wi-Fi egress-IP allowlist:** feasible as a *soft signal* (read the client IP from PostgREST request headers inside the RPC, e.g. `current_setting('request.headers', true)::json->>'x-forwarded-for'`; verify on your project). But Regus Wi-Fi may be shared with other tenants or change IP, and phones on mobile data won't match. Use it to flag, not to block.
- **Automated face comparison:** it would turn selfies into biometric (sensitive) information, trigger the Kmart/Bunnings bar, and require a privacy impact assessment and express consent. Not proportionate for 3–10 interns. Human spot checks do the job.

---

## 4. Hardening checklists

### 4.1 Supabase
**Project and platform**
- [ ] Region: **Oceania (Sydney) ap-southeast-2**. Region can't be changed in place. If the current project is elsewhere, create a new Sydney project and migrate (Supabase docs), then update the URL and keys.
- [ ] Free-plan realities: **no automated backups**, pause after **7 days of low activity** (restorable from the dashboard for 1 year), no PITR. Pro ($25/month) adds 7 days of daily backups and no pausing. **Recommendation:** upgrade to Pro once real interns are enrolled. The cost is trivial next to losing a university hours record. Until then, run a scheduled GitHub Action doing `supabase db dump` to an encrypted private location with 30-day rotation.
- [ ] Settings → API → Exposed schemas: keep `public` only (plus `graphql_public` only if you use GraphQL). Never expose `private`.
- [ ] If GraphQL is unused, disable `pg_graphql` (or revoke usage) to shrink the attack surface.
- [ ] Check SSL enforcement and network restrictions in Database settings. Availability varies by plan, so confirm in your dashboard.

**Database / RLS**
- [ ] RLS enabled on every table in exposed schemas (lint 0013). No `using (true)` on personal data (lint 0024).
- [ ] Views: `create view ... with (security_invoker = true)` (lint 0010).
- [ ] Every function: `set search_path = ''` and fully schema-qualified names (lint 0011).
- [ ] SECURITY DEFINER functions only in `private`. Public wrappers are SECURITY INVOKER. Fix lints 0028/0029 (definer functions executable by `anon` / `authenticated`).
- [ ] Default privileges: `alter default privileges in schema public revoke execute on functions from public, anon;` then grant per function to `authenticated`.
- [ ] Event tables are write-only via RPC: `revoke insert, update, delete on public.clock_events from anon, authenticated;`
- [ ] Audit log append-only: revoke UPDATE/DELETE from all API roles; add a trigger that raises on update or delete; optional `prev_hash` chain.
- [ ] Last-admin guard: a trigger blocking removal or demotion of the final active admin.
- [ ] Re-run Security Advisor after every migration. Make `supabase db lint` fail CI, not `continue-on-error`.
- [ ] Remove the old plain-text password table entirely (drop the column/table, then `VACUUM FULL`). Treat the exposed passwords as compromised and force resets.

**Auth**
- [ ] MFA (TOTP) for supervisors and admin, enforced in the database:
```sql
create policy "staff tables require aal2" on public.supervisor_reviews
  as restrictive to authenticated
  using ((select auth.jwt()->>'aal') = 'aal2' or not private.is_staff());
```
- [ ] CAPTCHA (Cloudflare Turnstile or hCaptcha): Settings → Authentication → Bot and Abuse Protection. It covers sign-in, sign-up and password reset. The docs don't say it is plan-gated; confirm on your free project.
- [ ] Password policy: minimum 12 characters, mixed character classes. **Leaked-password protection is Pro-only.** Supabase's password security docs say Auth "uses the open-source HaveIBeenPwned.org Pwned Passwords API" and that "Leaked password protection is available on the Pro Plan and above."
- [ ] Disable public sign-ups; admin invites only. Keep "Confirm email" on, which returns an obfuscated user for existing emails and limits enumeration. Use one generic message for failed sign-in and reset.
- [ ] JWT expiry: keep the default **1 hour**. Keep refresh token reuse detection on (default 10-second reuse interval).
- [ ] Time-boxed sessions, inactivity timeout and single-session-per-user are **Pro-only**. On free, add a client-side idle sign-out (e.g. 30 minutes) and a "Sign out all devices" button calling `signOut({ scope: 'global' })`.
- [ ] Custom SMTP (your domain) for reset and invite emails, with SPF, DKIM and DMARC. Review Auth rate limits.

**Storage**
- [ ] Buckets `selfies` and `medical` private; RLS on `storage.objects` by `(storage.foldername(name))[1] = auth.uid()::text` or assigned supervisor.
- [ ] `createSignedUrl(path, 120)`: short expiry, generated on demand, never persisted.
- [ ] MIME and size limits on buckets (image/jpeg ≤ 2 MB; application/pdf and image/jpeg ≤ 5 MB for certificates).
- [ ] Delete files **only via the Storage API**. Supabase: "Deleting objects via a SQL query will not remove the object from the bucket and will result in the object being orphaned."

**Realtime, pg_cron, pg_net, Edge Functions**
- [ ] Notifications via `postgres_changes` on an RLS-protected table, or private channels with RLS on `realtime.messages`. Never broadcast personal data on public channels.
- [ ] Secrets in Supabase Vault or Edge Function secrets, never in `cron.job` command text or the repo.
- [ ] `service_role` key only inside Edge Functions. Grep the bundle in CI for `service_role` and `sb_secret_`.
- [ ] Delete the dead Edge Function. Every function verifies the JWT and role.

### 4.2 GitHub Pages / front-end
- [ ] GitHub Pages **cannot set response headers**. `frame-ancestors` is ignored in a `<meta>` CSP, so there is no clickjacking protection, no HSTS control, no `Permissions-Policy`. **Recommendation:** move to Cloudflare Pages or Netlify (free tiers currently fit this scale) with a `_headers` file, or front GitHub Pages with Cloudflare Transform Rules.
- [ ] Headers to send: `Strict-Transport-Security: max-age=31536000; includeSubDomains`; `Content-Security-Policy: default-src 'self'; connect-src 'self' https://<ref>.supabase.co wss://<ref>.supabase.co; img-src 'self' blob: data: https://<ref>.supabase.co; frame-ancestors 'none'; object-src 'none'; base-uri 'self'` (Next.js static export emits inline scripts, so add their hashes rather than `'unsafe-inline'`); `X-Content-Type-Options: nosniff`; `Referrer-Policy: strict-origin-when-cross-origin`; `Permissions-Policy: camera=(self), geolocation=(self), microphone=()`.
- [ ] Until you move, ship a meta CSP anyway (it still restricts scripts and connections).
- [ ] XSS: never use `dangerouslySetInnerHTML` on user text; allow only `https:` in any user-supplied link; generate PDFs from structured data; escape CSV cells starting with `= + - @`.
- [ ] Tokens: supabase-js keeps the session in localStorage, so any XSS means account takeover. The CSP and "no raw HTML" rules are your main defence. On shared devices, offer "This isn't my device", which uses sessionStorage.
- [ ] Supply chain: commit the lockfile, use `npm ci`, enable Dependabot, pin Actions by SHA, set `permissions:` to the minimum in workflows, and turn on secret scanning and push protection. Enable branch protection on `main`.

### 4.3 Standards mapping (for your own tracking)
- **OWASP Top 10:2025:** A01 Broken Access Control (loopholes 1, 9, 12, 13); A02 Security Misconfiguration (12, 13, headers); A03 Software Supply Chain Failures (19); A06 Insecure Design (2–8); A07 Authentication Failures (14, 16); A09 Security Logging and Alerting Failures (audit log, flags).
- **OWASP ASVS:** use Level 2 as the target for access control, authentication, session management and data protection chapters.
- **OWASP MASVS:** mostly for native apps. For a PWA, the relevant ideas are "don't trust the client" and storage of tokens.
- **ACSC Essential Eight (right-sized):** MFA on Supabase, GitHub, Cloudflare, email and admin accounts; regular backups (off-site, tested restore); patch apps and OS on staff phones and laptops; restrict admin privileges (one admin, separate from daily supervisor use); user application hardening (browser updates).

---

## 5. Build rules for DGK Clock (paste into the Claude Code prompt)

1. **Server is the source of truth.** No business rule is enforced only in the client. Every write to `clock_events`, `punch_fixes`, `leave_requests`, `approvals` and `consent_records` goes through a `public` SECURITY INVOKER RPC wrapping a `private` SECURITY DEFINER function with `set search_path = ''`. Table-level INSERT/UPDATE/DELETE is revoked from `anon` and `authenticated`.
2. **Server time only.** `occurred_at` is set with `private.app_now()` (returns `now()` unless `session_user = 'postgres'` and `daymark.test_now` is set via `SET LOCAL`). Client timestamps are stored only as `client_reported_at` for forensics and never used for hours.
3. **Geofence in SQL.** Store the office in `offices(id, name, lat, lng, radius_m default 200, tz default 'Australia/Darwin')`. The clock RPC computes haversine distance and rejects if `distance_m > radius_m` or `accuracy_m > 150`. It stores `distance_m`, `accuracy_m`, `lat`, `lng` and the flag set.
4. **Time window in SQL.** Reject unless `now() at time zone 'Australia/Darwin'` is Mon–Fri 07:00–18:59. Also reject if before `placement.start_date`, after `placement.end_date`, or once approved hours ≥ `placement.target_hours` (unless `extension_confirmed_by_uni = true`).
5. **Challenge nonce.** `start_clock(kind)` inserts `clock_challenges(id, user_id, kind, gesture, issued_at, expires_at = now() + interval '90 seconds', used_at)` and returns the gesture. `clock_in/out(challenge_id, ...)` requires an unexpired, unused challenge owned by `auth.uid()` and sets `used_at` in the same transaction.
6. **Rotating office code.** Add `private.office_secrets(office_id, secret bytea)`. `public.kiosk_current_code()` (callable only by a `kiosk` role user on an office tablet) returns a 6-digit code from `hmac(floor(extract(epoch from now())/30)::text, secret, 'sha256')`. GPS clock events must include the current or previous code. This is a config flag `require_office_code` (default on).
7. **Liveness-lite selfie.** Capture only via `getUserMedia` live video → canvas → JPEG (no file input, no gallery). The prompt shows the server gesture ("hold up 3 fingers", "touch your left ear"). Upload to `selfies/{user_id}/{challenge_id}.jpg`. The RPC verifies the object exists, `owner_id = auth.uid()`, and it was created within 3 minutes of `issued_at`. No face recognition, ever.
8. **Sequence and dedupe.** Reject `in` if the last event today is `in`, and reject `out` without an open `in`. Allow at most 1 event per user per 60 seconds. At 19:00, `pg_cron` closes open sessions as `status = 'unverified'`, counting 0 hours until a fix is approved.
9. **Fraud flags, not silent blocks.** Store `flags text[]`: `low_accuracy`, `suspicious_accuracy` (≤ 3 m), `repeat_coords` (identical to 5 decimals on a previous day), `impossible_travel`, `desktop_ua`, `ip_mismatch` (optional office-IP check), `new_device`. Supervisors get a weekly "flagged events" view.
10. **Verification method per entry.** `verification_method in ('gps_selfie_code','gps_selfie','supervisor','punch_fix')`. The university PDF shows the method and approver per entry, plus a report ID and SHA-256 of the report data stored in `uni_reports`.
11. **Consent gating.** Before any clock RPC, `private.has_consent(auth.uid(),'location')` and `'selfie'` must both be true. Otherwise only `request_supervisor_confirmation()` is allowed. Consent tables follow Section 2.6 (append-only, versioned, hashed notice text).
12. **No third-party geocoding.** Remove Nominatim and Google reverse geocoding. The server sets `place_label` from the office row (e.g. "DGK office – Regus Palmerston") when inside the geofence. (Nominatim's policy allows a maximum of 1 request per second, requires an identifying User-Agent that browsers can't set, and sends coordinates offshore.)
13. **Segregation of duties.** Check constraint or trigger: `approver_id <> subject_user_id` on all approvals. A user with both intern and supervisor roles must be approved by another supervisor or the admin. Admin self-approvals are allowed only with `reason` and flagged in the report.
14. **Punch-fix limits.** A fix requires a reason (at least 20 characters), is capped at 2 per rolling fortnight per intern (admin override logged), and cannot create hours outside 07:00–19:00 or on weekends.
15. **MFA for staff.** Supervisors and admin must enrol TOTP on first sign-in. Restrictive RLS on all staff-readable tables requires `aal2`. Show a recovery process (the admin resets factors, and the reset is logged).
16. **CAPTCHA** (Turnstile) on sign-in and password reset. Generic error messages. Invite-only accounts.
17. **Session hygiene.** 30-minute client idle sign-out; "Sign out everywhere"; "This isn't my device" (sessionStorage); global sign-out after a password change.
18. **Offboarding.** On `placement.end_date`, set `profiles.active = false` (all RLS policies require `active`). An Edge Function (service role) bans the auth user and revokes sessions. Supervisor role removal takes effect the same way.
19. **Last-admin guard** trigger. The audit log is append-only (no UPDATE/DELETE grants, trigger raises), and records `actor_id, action, entity, entity_id, at, ip, user_agent, before/after (redacted)`.
20. **Medical certificates minimised.** Offer a "sighted in person" checkbox. If uploaded, store in the `medical` bucket, visible to the assigned supervisor and admin only, with signed URLs ≤ 120 seconds. Auto-delete the file 7 days after the leave decision (configurable), keeping only `certificate_sighted = true`.
21. **Deletion job.** A daily `pg_cron` job selects interns with `end_date + 30 days < today`. An Edge Function removes all their Storage objects via the Storage API, then deletes DB rows. It writes `deletion_log(subject_hash, deleted_at, rows_deleted, objects_deleted)` with no personal data. Off-site backups rotate within 30 days so the promise holds.
22. **Security Advisor clean in CI** (`supabase db lint` fails the build). A test asserts `anon` cannot SELECT any table or EXECUTE any non-whitelisted function.
23. **Front-end:** no `dangerouslySetInnerHTML`; https-only links; PDF from data; CSV formula escaping; strict CSP (meta now, header after moving host).
24. **Fortnight summary for interns.** Show approved hours per Monday-start fortnight (to help visa holders self-monitor). Don't collect visa status.

---

## 6. Data breach mini-plan (NDB-aligned, voluntary for DGK)

**Roles:** Dilip (incident lead and decision-maker); one supervisor (deputy); a technical helper on call.

1. **Contain (hour 0–4):** disable affected accounts; `signOut` globally or ban users; rotate the Supabase keys that may be exposed (and the JWT secret if session tokens are at risk); revoke GitHub tokens; take the site offline or put up a maintenance page if the front end is compromised; preserve logs (export Supabase logs now, because free-plan log retention is short).
2. **Assess (aim ≤ 72 hours; legal outer limit for APP entities is 30 calendar days):** what data (selfies, medical certificates and location are high-harm), whose data, was it accessed or exfiltrated, can remedial action remove the likely serious harm (e.g. files deleted by the recipient, access revoked before viewing)?
3. **Notify if likely serious harm:** OAIC statement via its online NDB form. Under s 26WK it contains DGK's identity and contact details, a description of the breach, the kinds of information, and recommended steps for individuals. Tell each affected intern directly by email or phone. Tell each university coordinator (check your placement agreements for deadlines). Consider reporting via cyber.gov.au (ReportCyber) and referring interns to IDCARE.
4. **Review (within 2 weeks):** root cause, fix, update this register, and record the incident in the audit log and an incident register (keep the register itself free of unnecessary personal data).

Pre-write templates now: the intern email, the university email and the OAIC statement fields. Test once a year with a tabletop exercise (e.g. "a selfie signed URL was posted in a group chat").

---

## 7. Caveats and where to get legal advice
- **This is not legal advice.** Get a short written opinion from an NT privacy or employment lawyer on: (a) whether DGK is definitely a small business operator (turnover history since 2001, related entities); (b) whether to opt in to the Privacy Act formally; (c) whether the Geolocation API use fits "tracking device" under the NT Act (I have assumed it does and designed for consent); (d) your university placement agreements' data, records and breach clauses.
- **The selfie classification rests on OAIC guidance** tying "sensitive" status to automated verification or identification. A regulator or court could take a broader view, and the Tranche 2 draft may change definitions. Treating selfies as high-risk, as this design does, is the safe course.
- **The Bunnings and Kmart outcomes are still moving.** In *Bunnings Group Limited and Privacy Commissioner* [2026] ARTA 130 (4 February 2026), the Administrative Review Tribunal affirmed the APP 1 and APP 5 findings. It departed on APP 3.3, holding Bunnings "was entitled to rely on exemptions to the requirement to obtain consent". The OAIC then issued updated retail FRT guidance. Kmart is under ART review with hearings scheduled for early 2027.
- **Tranche 2 is an exposure draft, not law.** It has no commencement date. Watch for the Bill's introduction.
- **Visa rule sources:** the "mandatory placement doesn't count if specified in the CoE/course" position comes from university and migration-lawyer guidance, not a Home Affairs page I verified directly. Deakin notes that WIL hours not specified at CRICOS registration **do** count. Interns should confirm with their university's international office. Claims of a 60-hour limit from 1 July 2026 were described as a proposal only.
- **Supabase plan features change.** CAPTCHA plan availability isn't stated in the docs, network restrictions and SSL enforcement availability wasn't verified, and the request-header IP technique should be tested on your project.
- **The Lovable CVE-2025-48757 figures** come from researcher Matt Palmer's own "Statement on CVE-2025-48757" (May 2025). It says a scan completed on 21 March "identified 303 endpoints across 170 projects (approximately 10.3% of the 1645 analyzed) with inadequate RLS settings." The lesson: with a public anon key, RLS is the only lock.
- **Effectiveness ratings** in the loophole register are expert judgement for a small, supervised office. No browser-only design can fully stop a determined intern with an accomplice on site. The office code, the gesture selfie and human spot checks together make fraud effortful and visible, which is proportionate to the stakes.
