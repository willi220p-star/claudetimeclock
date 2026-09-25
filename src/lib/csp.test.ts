import { describe, expect, test } from "vitest";
import { contentSecurityPolicy } from "@/lib/csp";

describe("contentSecurityPolicy", () => {
  test("allows the Supabase project over https and wss, nothing else third-party", () => {
    const csp = contentSecurityPolicy("https://abc.supabase.co/");
    expect(csp).toContain("connect-src 'self' https://abc.supabase.co wss://abc.supabase.co");
    expect(csp).toContain("img-src 'self' blob: data: https://abc.supabase.co");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).not.toContain("unsafe-eval");
  });

  test("the local stack uses ws, and development allows eval", () => {
    const csp = contentSecurityPolicy("http://127.0.0.1:54321", true);
    expect(csp).toContain("connect-src 'self' http://127.0.0.1:54321 ws://127.0.0.1:54321");
    expect(csp).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval'");
  });
});
