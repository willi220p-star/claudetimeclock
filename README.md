# DGK Clock

A shift clock for the Regus office on the first floor at 1 Palmerston Circuit, Palmerston, above Service Australia. Admins create a login ID, email, and password for each person. Forgot password sends a reset link to that email. Clock in, clock out, break in, and break out only work within 200 metres of that office. Every punch stores a photo and the full address, and each day is one table row. Worked time is the shift minus breaks.

## Run it

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open [http://127.0.0.1:41731](http://127.0.0.1:41731).

The public site is [https://willi220p-star.github.io/presence-tracker/](https://willi220p-star.github.io/presence-tracker/). Pushes to `main` publish it with GitHub Pages.

The starter admin password is changed from the admin desk. It is not shown on the sign-in page.

## What each person sees

**Admin** can add people, save the email used for a password reset, pause a login, and read every time card in a day table: clock in, clock out, break in, and break out, with the suburb and street on the row. A small photo opens larger when selected.

**Staff** see a live clock, today's worked time with breaks taken out, the full address, and the same day table. The camera asks for access on the punch.

## Supabase

The browser client lives in `src/lib/supabase/client.ts`. Server components use `src/lib/supabase/server.ts`.

DGK Clock tables are in the personal Supabase project. A new project could not be created because the free plan already has two projects. The campaign project was left alone.

Schema, row-level security, and the private photo bucket are in `supabase/migrations/20260924040000_daymark.sql`. Admins create staff with the `create_staff_login` database function, so the service role stays off the browser.
