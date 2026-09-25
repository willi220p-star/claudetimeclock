import { describe, expect, test } from "vitest";
import { contentSecurityPolicy } from "@/lib/csp";

describe("contentSecurityPolicy", () => {
  test("allows the Supabase project over https and wss, nothing else third-party, and WebAssembly but not eval", () => {
    const csp = contentSecurityPolicy("https://abc.supabase.co/");
    expect(csp).toContain("connect-src 'self' data: https://abc.supabase.co wss://abc.supabase.co");
    expect(csp).toContain("img-src 'self' blob: data: https://abc.supabase.co");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval';");
    expect(csp).not.toContain("'unsafe-eval'");
  });

  test("the local stack uses ws, and development allows eval", () => {
    const csp = contentSecurityPolicy("http://127.0.0.1:54321", true);
    expect(csp).toContain("connect-src 'self' data: http://127.0.0.1:54321 ws://127.0.0.1:54321");
    expect(csp).toContain("script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' 'unsafe-eval'");
  });
});
