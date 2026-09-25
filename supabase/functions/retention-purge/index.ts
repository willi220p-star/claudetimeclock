// Nightly retention purge (ADR 0003, build prompt §8.12, security review rule 21).
// Called by pg_cron through pg_net with the `x-cron-secret` header. Storage objects are removed
// through the Storage API (direct SQL deletes on storage.objects are blocked and would orphan
// files), rows by `purge_intern` in one transaction, then the Auth user through the Admin API.
import { createClient } from "npm:@supabase/supabase-js@2";

const BUCKETS = ["daymark-photos", "daymark-leave-docs"];

type Admin = ReturnType<typeof createClient>;

async function listAll(admin: Admin, bucket: string, prefix: string) {
  const paths: string[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: 1000, offset });
    if (error) throw new Error(`${bucket}: ${error.message}`);
    paths.push(...(data ?? []).filter((item) => item.id).map((item) => `${prefix}/${item.name}`));
    if (!data || data.length < 1000) return paths;
  }
}

async function removeAll(admin: Admin, bucket: string, paths: string[]) {
  for (let i = 0; i < paths.length; i += 100) {
    const { error } = await admin.storage.from(bucket).remove(paths.slice(i, i + 100));
    if (error) throw new Error(`${bucket}: ${error.message}`);
  }
  return paths.length;
}

Deno.serve(async (req) => {
  const secret = Deno.env.get("CRON_SECRET");
  if (!secret || req.headers.get("x-cron-secret") !== secret) {
    return new Response("Forbidden", { status: 403 });
  }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const report: Array<Record<string, unknown>> = [];

  // Medical certificate files: 7 days after the leave decision (review rule 20).
  const { data: certs, error: certError } = await admin.rpc("retention_certificates_due");
  if (certError) return Response.json({ ok: false, error: certError.message }, { status: 500 });
  for (const cert of (certs ?? []) as Array<{ request_id: string; attachment_path: string }>) {
    try {
      await removeAll(admin, "daymark-leave-docs", [cert.attachment_path]);
      const { error } = await admin.rpc("retention_certificate_removed", { request_id: cert.request_id });
      if (error) throw new Error(error.message);
      report.push({ certificate: cert.request_id, ok: true });
    } catch (error) {
      report.push({ certificate: cert.request_id, ok: false, error: String(error) });
    }
  }

  // Interns 30 days after their placement ended.
  const { data: due, error: dueError } = await admin.rpc("retention_due");
  if (dueError) return Response.json({ ok: false, error: dueError.message }, { status: 500 });

  for (const { intern_id } of (due ?? []) as Array<{ intern_id: string }>) {
    try {
      let objects = 0;
      for (const bucket of BUCKETS) {
        objects += await removeAll(admin, bucket, await listAll(admin, bucket, intern_id));
      }
      const { data: counts, error: purgeError } = await admin.rpc("purge_intern", {
        intern: intern_id,
        objects_deleted: objects,
      });
      if (purgeError) throw new Error(purgeError.message);
      const { error: authError } = await admin.auth.admin.deleteUser(intern_id);
      if (authError) throw new Error(`auth: ${authError.message}`);
      report.push({ ok: true, objects, rows: counts });
    } catch (error) {
      // No ids or names in the response: it may end up in logs.
      report.push({ ok: false, error: String(error) });
    }
  }

  const ok = report.every((item) => item.ok);
  return Response.json({ ok, processed: report.length, report }, { status: ok ? 200 : 500 });
});
