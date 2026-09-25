# 0001 Static export, business logic in Postgres

Status: accepted (2026-09-25)

## Context
DGK Clock is hosted on GitHub Pages (free, static only) with Supabase (free plan). There is no server at runtime and the anon key is public, so anyone can call the REST and RPC API directly.

## Decision
- Next.js `output: "export"`. No server actions, route handlers, middleware, `cookies()`/`headers()` or dynamic route segments. Detail pages use query strings read with `useSearchParams()` inside `<Suspense>`.
- Every business rule lives in Postgres: constraints, triggers, RLS, views and functions. The browser only displays and submits.
- Privileged logic is in `private` `SECURITY DEFINER` functions with `set search_path = ''`. The client calls thin `public` `SECURITY INVOKER` wrappers. Execute is revoked from `public`/`anon` and granted to `authenticated` explicitly.
- Writes to punches, requests and consent records go through RPCs only. Table-level insert/update/delete is revoked from API roles.
- Time comes from `private.clock_now()`, never the client.
- Scheduled work uses `pg_cron`. Edge Functions are used only where Postgres can't do the job (Storage object and Auth user deletion).
- Security headers GitHub Pages can't send are approximated with a meta CSP. Moving host (Cloudflare Pages) is an open question for Dilip.

## Consequences
Rules are testable with pgTAP and can't be bypassed by a crafted API call. The UI has to fetch everything client-side.
