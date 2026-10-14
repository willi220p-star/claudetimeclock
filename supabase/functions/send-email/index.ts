// Sends due notification emails through the Apps Script web app (D50). Called every minute by pg_cron
// (private.call_send_email) with the `x-cron-secret` header, only when something is due and today's
// cap has room. Each row is signed with HMAC-SHA-256; Apps Script sends it with MailApp.
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildRequest, type Claimed, type Outcome, outcomeFor, precheck } from "./email.ts";

Deno.serve(async (req) => {
  const cronSecret = Deno.env.get("CRON_SECRET");
  const webAppUrl = Deno.env.get("APPS_SCRIPT_WEB_APP_URL");
  const sharedSecret = Deno.env.get("APPS_SCRIPT_SHARED_SECRET");
  const baseUrl = Deno.env.get("APP_BASE_URL");
  if (!cronSecret) return new Response("not configured", { status: 500 });
  if (req.headers.get("x-cron-secret") !== cronSecret) return new Response("Forbidden", { status: 403 });
  // Nothing is claimed until every secret is set.
  if (!webAppUrl || !sharedSecret || !baseUrl || !baseUrl.startsWith("https://")) {
    return new Response("not configured", { status: 500 });
  }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await admin.rpc("email_claim", { max_rows: 20 });
  if (error) return new Response(error.message, { status: 500 });

  const report: Record<string, number> = {};
  for (const row of (data ?? []) as Claimed[]) {
    let result: Outcome | null = precheck(row);
    if (!result) {
      try {
        const res = await fetch(webAppUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: await buildRequest(row, baseUrl, sharedSecret),
          signal: AbortSignal.timeout(20000),
        });
        result = outcomeFor({ body: await res.text() });
      } catch (failure) {
        result = outcomeFor({ error: failure });
      }
    }
    const { error: markError } = await admin.rpc("email_mark", {
      id: row.id,
      status: result.status,
      error_code: result.code,
      error_message: result.message,
    });
    report[result.status] = (report[result.status] ?? 0) + 1;
    // One line per row: never the address, secret, signature or body.
    console.log(JSON.stringify({
      event_id: row.id,
      correlation_id: row.correlation_id,
      template_id: row.template_id,
      recipient_category: row.recipient_category,
      attempts: row.attempts,
      status: result.status,
      code: markError ? "mark_failed" : result.code,
    }));
  }
  return Response.json(report);
});
