import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/database.types";

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    throw new Error("Supabase URL and publishable key are not set.");
  }

  return createBrowserClient<Database>(url, key, {
    auth: {
      flowType: "implicit",
      detectSessionInUrl: true,
    },
  });
}
