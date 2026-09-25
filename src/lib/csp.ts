/**
 * The meta Content-Security-Policy (§14; GitHub Pages can't send headers). Sources are this site
 * plus the Supabase project (REST, Storage and Realtime over wss).
 *
 * script-src keeps 'unsafe-inline' because Next's static export writes its bootstrap and RSC
 * payload as inline scripts, and a static page has no per-request nonce. The upgrade path is
 * hashes or a header-capable host (security review §4.2). Development also needs 'unsafe-eval'.
 */
export function contentSecurityPolicy(supabaseUrl: string, development = false) {
  const supabase = supabaseUrl.replace(/\/+$/, "");
  const realtime = supabase.replace(/^http/, "ws");
  return [
    "default-src 'self'",
    `connect-src 'self' ${supabase} ${realtime}`,
    `img-src 'self' blob: data: ${supabase}`,
    "media-src 'self' blob:",
    "style-src 'self' 'unsafe-inline'",
    `script-src 'self' 'unsafe-inline'${development ? " 'unsafe-eval'" : ""}`,
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}
