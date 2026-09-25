import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json({ error: "Sign in as an admin first." }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return json({ error: "Server is missing credentials." }, 500);
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const token = authHeader.slice("Bearer ".length);
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) {
    return json({ error: "Sign in as an admin first." }, 401);
  }

  const { data: caller, error: callerError } = await admin
    .from("daymark_profiles")
    .select("role, active")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (callerError || caller?.role !== "admin" || !caller.active) {
    return json({ error: "Only an active admin can add people." }, 403);
  }

  let body: { login_id?: string; password?: string; display_name?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Send a name, login ID, and password." }, 400);
  }

  const loginId = (body.login_id ?? "").trim().toLowerCase();
  const displayName = (body.display_name ?? "").trim();
  const password = body.password ?? "";

  if (!/^[a-z0-9][a-z0-9._-]{1,31}$/.test(loginId)) {
    return json(
      {
        error:
          "Login ID must be 2–32 characters: letters, numbers, dots, underscores, or hyphens.",
      },
      400,
    );
  }

  if (displayName.length < 1 || displayName.length > 80) {
    return json({ error: "Name must be between 1 and 80 characters." }, 400);
  }

  if (password.length < 8 || password.length > 72) {
    return json({ error: "Password must be 8–72 characters." }, 400);
  }

  const email = `${loginId}@daymark.example.com`;
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { role: "staff" },
  });

  if (createError || !created.user) {
    const raw = createError?.message ?? "Could not create this login.";
    const message = /already|registered|exists/i.test(raw)
      ? "That login ID is already in use."
      : raw;
    return json({ error: message }, 400);
  }

  const { error: profileError } = await admin.from("daymark_profiles").insert({
    id: created.user.id,
    login_id: loginId,
    display_name: displayName,
    role: "staff",
    active: true,
  });

  if (profileError) {
    await admin.auth.admin.deleteUser(created.user.id);
    const message = /duplicate|unique/i.test(profileError.message)
      ? "That login ID is already in use."
      : "Could not save the profile. Nothing was kept.";
    return json({ error: message }, 400);
  }

  return json(
    {
      profile: {
        id: created.user.id,
        login_id: loginId,
        display_name: displayName,
        role: "staff",
        active: true,
      },
    },
    200,
  );
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
