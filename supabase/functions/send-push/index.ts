// Sends due push notifications (D36). Called every minute by pg_cron (private.call_send_push) with the
// `x-cron-secret` header, only when something is due. VAPID keys are Edge Function secrets; the
// private key never reaches the app.
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import { type Due, outcome, payload, rowDone } from "./push.ts";

Deno.serve(async (req) => {
  const secret = Deno.env.get("CRON_SECRET");
  if (!secret || req.headers.get("x-cron-secret") !== secret) {
    return new Response("Forbidden", { status: 403 });
  }
  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  const privateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  const subject = Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@dgk.invalid";
  if (!publicKey || !privateKey) return new Response("VAPID keys are not set", { status: 500 });
  webpush.setVapidDetails(subject, publicKey, privateKey);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await admin.rpc("push_due", { max_rows: 100 });
  if (error) return new Response(error.message, { status: 500 });

  const rows = (data ?? []) as Due[];
  const report = { sent: 0, gone: 0, retry: 0 };
  const results = new Map<number, ReturnType<typeof outcome>[]>();
  const errors = new Map<number, string>();
  for (const row of rows) {
    let status: number | null = null;
    let message: string | null = null;
    try {
      const result = await webpush.sendNotification(
        { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
        payload(row),
        { TTL: 60 * 60 * 6, urgency: "normal" },
      );
      status = result.statusCode;
    } catch (failure) {
      status = (failure as { statusCode?: number }).statusCode ?? null;
      message = String((failure as Error).message ?? failure).slice(0, 300);
    }
    const result = outcome(status);
    report[result] += 1;
    if (result === "gone") {
      await admin.from("daymark_push_subscriptions").delete().eq("endpoint", row.endpoint);
    } else if (result === "sent") {
      await admin.from("daymark_push_subscriptions").update({ last_ok_at: new Date().toISOString() }).eq("endpoint", row.endpoint);
    }
    results.set(row.outbox_id, [...(results.get(row.outbox_id) ?? []), result]);
    if (result === "retry") errors.set(row.outbox_id, message ?? `HTTP ${status}`);
  }
  // Attempts are counted by private.call_send_push before each call; here rows are closed or noted.
  const done = [...results].filter(([, list]) => rowDone(list)).map(([id]) => id);
  if (done.length > 0) {
    const { error: doneError } = await admin.from("daymark_push_outbox").update({ sent_at: new Date().toISOString() }).in("id", done);
    if (doneError) return new Response(doneError.message, { status: 500 });
  }
  for (const [id, text] of errors) {
    if (!done.includes(id)) await admin.from("daymark_push_outbox").update({ error: text }).eq("id", id);
  }
  return Response.json(report);
});
