import { execFileSync } from "node:child_process";
import path from "node:path";
import { test as base, expect, type Page } from "@playwright/test";

export { expect };

/** Seed logins (supabase/seed.sql). The seed decides which intern plays which golden path. */
export const SEED = {
  password: "Password-1234",
  admin: "admin@dgk.test",
  supervisors: ["sup1@dgk.test", "sup2@dgk.test"],
  /** Holds more than one role flag; lands on the highest role's home. */
  dual: "dual@dgk.test",
  interns: [1, 2, 3, 4, 5, 6, 7].map((n) => `intern${n}@dgk.test`),
} as const;

/** The seeded site, matching `geolocation` in playwright.config.ts. */
export const OFFICE = { latitude: -12.4785082, longitude: 130.9854825, accuracy: 10 } as const;

/** Metres per degree of latitude on the 6,371 km sphere that the haversine check uses. */
const METRES_PER_DEGREE = 111_194.93;

/**
 * Local-only superuser. The `postgres` role is not a superuser in the Supabase stack, and Postgres
 * only lets a superuser set an unregistered parameter such as `daymark.test_now` with ALTER DATABASE.
 */
const ADMIN_DB_URL =
  process.env.E2E_ADMIN_DB_URL ?? "postgresql://supabase_admin:postgres@127.0.0.1:54322/postgres";

const ROOT = path.resolve(__dirname, "..");

/** Collects console errors and uncaught page errors; assert it is empty at the end of a test. */
export const test = base.extend<{ consoleErrors: string[] }>({
  consoleErrors: async ({ page }, provide) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));
    await provide(errors);
  },
});

/** Signs in from `/` with the accessible form and waits until the app navigates away. */
export async function signIn(page: Page, email: string, password: string = SEED.password) {
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => url.pathname !== "/");
}

/** Moves the stubbed device `metresNorth` from the office (negative is south). 0 puts it back. */
export async function moveTo(page: Page, metresNorth: number) {
  await page.context().setGeolocation({
    ...OFFICE,
    latitude: OFFICE.latitude + metresNorth / METRES_PER_DEGREE,
  });
}

/**
 * Freezes `private.clock_now()` for every new database session, e.g. setOfficeClock("2026-10-06T08:55").
 * A time without an offset is read as Darwin time (+09:30, no daylight saving).
 */
export function setOfficeClock(isoDarwin: string) {
  const iso = /(Z|[+-]\d\d:\d\d)$/.test(isoDarwin) ? isoDarwin : `${isoDarwin}+09:30`;
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d(\.\d+)?)?(Z|[+-]\d\d:\d\d)$/.test(iso) || Number.isNaN(Date.parse(iso))) {
    throw new Error(`setOfficeClock needs an ISO date-time, got "${isoDarwin}"`);
  }
  runAdminSql(`
    alter database postgres set daymark.e2e_clock = 'on';
    alter database postgres set daymark.test_now = '${iso}';
  `);
}

/** Puts `private.clock_now()` back on the real clock. */
export function clearOfficeClock() {
  runAdminSql(`
    alter database postgres reset daymark.test_now;
    alter database postgres reset daymark.e2e_clock;
  `);
}

/** `supabase db reset`: migrations plus seed. Run from globalSetup when E2E_RESET=1. */
export function resetDatabase() {
  execFileSync("supabase", ["db", "reset"], { cwd: ROOT, stdio: "inherit" });
}

/**
 * Database-level settings reach only sessions opened afterwards, and PostgREST keeps a pool.
 * A schema reload makes PostgREST release its pooled connections, so wait until every connection
 * that existed before the change has gone. The LISTEN connection is not pooled and stays.
 */
function runAdminSql(statements: string) {
  const sql = `
    ${statements}
    select set_config('e2e.stale_pids', coalesce(string_agg(pid::text, ','), ''), false)
      from pg_stat_activity where usename = 'authenticator' and query not ilike 'listen%';
    notify pgrst, 'reload schema';
    do $$
    begin
      for i in 1..50 loop
        perform pg_stat_clear_snapshot(); -- pg_stat_activity is otherwise frozen for the transaction
        exit when not exists (
          select 1 from pg_stat_activity
          where pid = any (string_to_array(nullif(current_setting('e2e.stale_pids'), ''), ',')::int[]));
        perform pg_sleep(0.1);
      end loop;
    end $$;
  `;
  // Each statement runs in its own transaction, so the NOTIFY is delivered before the wait starts.
  execFileSync("psql", [ADMIN_DB_URL, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-f", "-"], {
    input: sql,
    stdio: ["pipe", "ignore", "pipe"],
  });
}
