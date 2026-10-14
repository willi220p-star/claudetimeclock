// @vitest-environment node
// Runs under Vitest (no Deno here); email.ts is plain TypeScript. Node's Web Crypto signs like Deno's.
import { createHmac } from "node:crypto";
import { describe, expect, test } from "vitest";
import {
  buildActionUrl,
  buildPayload,
  buildRequest,
  canonicalString,
  type Claimed,
  formatDarwin,
  outcomeFor,
  precheck,
  sign,
} from "./email";

const BASE = "https://willi220p-star.github.io/claudetimeclock";
const row: Claimed = {
  id: "11111111-1111-4111-8111-111111111111",
  correlation_id: "22222222-2222-4222-8222-222222222222",
  template_id: "request_update",
  recipient_category: "user",
  kind: "request",
  title: "Leave approved",
  body: "Your leave on Fri 17 Oct is approved.",
  link: "/clock/requests",
  created_at: "2026-10-13T23:35:00Z", // Wed 14 Oct, 9:05 am Darwin
  attempts: 1,
  recipient_name: "Jo",
  recipient_email: "jo@example.com",
  test_only: false,
  allowed: true,
};

describe("signing", () => {
  test("canonical string is v1.ts.event_id.payload", () => {
    expect(canonicalString(1760400000, "abc", '{"a":1}')).toBe('v1.1760400000.abc.{"a":1}');
  });

  test("HMAC-SHA-256 matches node:crypto and a known vector", async () => {
    const message = canonicalString(1760400000, row.id, '{"x":"é"}');
    expect(await sign("s3cret-ü", message)).toBe(createHmac("sha256", "s3cret-ü").update(message, "utf8").digest("hex"));
    // RFC 4231 test case 2.
    expect(await sign("Jefe", "what do ya want for nothing?")).toBe(
      "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
    );
  });

  test("the request carries the signed payload string and a fresh timestamp", async () => {
    const body = JSON.parse(await buildRequest(row, BASE, "secret", 1760400000_500));
    expect(Object.keys(body).sort()).toEqual(["event_id", "payload", "sig", "ts", "v"]);
    expect(body).toMatchObject({ v: 1, ts: 1760400000, event_id: row.id });
    expect(typeof body.payload).toBe("string");
    expect(body.sig).toBe(
      createHmac("sha256", "secret").update(`v1.1760400000.${row.id}.${body.payload}`, "utf8").digest("hex"),
    );
  });
});

describe("payload", () => {
  test("has exactly the contract's fields and nothing else from the row", () => {
    const payload = JSON.parse(buildPayload({ ...row, kind: "secret-kind", attempts: 9 } as Claimed, BASE));
    expect(payload).toEqual({
      event_id: row.id,
      correlation_id: row.correlation_id,
      template_id: "request_update",
      recipient_category: "user",
      to: "jo@example.com",
      data: {
        recipient_name: "Jo",
        event_title: "Leave approved",
        event_message: "Your leave on Fri 17 Oct is approved.",
        action_url: `${BASE}/clock/requests`,
        event_timestamp: "Wed 14 Oct, 9:05 am",
      },
    });
  });

  test("action_url takes only relative links, on an https base", () => {
    expect(buildActionUrl(BASE + "/", "/admin/requests?tab=open")).toBe(`${BASE}/admin/requests?tab=open`);
    expect(buildActionUrl(BASE, null)).toBe(`${BASE}/notifications`);
    expect(buildActionUrl(BASE, "https://evil.example/x")).toBe(`${BASE}/notifications`);
    expect(buildActionUrl(BASE, "//evil.example/x")).toBe(`${BASE}/notifications`);
    expect(buildActionUrl(BASE, "clock")).toBe(`${BASE}/notifications`);
    expect(() => buildActionUrl("http://willi220p-star.github.io/claudetimeclock", "/clock")).toThrow();
    expect(() => buildActionUrl("", "/clock")).toThrow();
  });

  test("timestamps are Darwin time", () => {
    expect(formatDarwin("2026-10-13T23:35:00Z")).toBe("Wed 14 Oct, 9:05 am");
    expect(formatDarwin("2026-10-14T05:30:00Z")).toBe("Wed 14 Oct, 3:00 pm");
    expect(formatDarwin("2026-10-14T14:30:00Z")).toBe("Thu 15 Oct, 12:00 am");
  });
});

describe("outcomes", () => {
  const reply = (value: unknown) => outcomeFor({ body: JSON.stringify(value) });

  test("sent and duplicate are sent", () => {
    expect(reply({ ok: true, event_id: row.id, status: "sent" })).toEqual({ status: "sent", code: null, message: null });
    expect(reply({ ok: true, event_id: row.id, status: "duplicate" }).status).toBe("sent");
  });

  test("retryable failures retry, permanent ones fail", () => {
    for (const code of ["quota_exceeded", "send_failed", "busy"]) {
      expect(reply({ ok: false, event_id: row.id, code, message: "m", retryable: true })).toEqual({
        status: "retry_pending",
        code,
        message: "m",
      });
    }
    for (const code of [
      "bad_request",
      "bad_signature",
      "stale_request",
      "unknown_template",
      "invalid_recipient",
      "recipient_not_allowed",
      "invalid_url",
    ]) {
      expect(reply({ ok: false, event_id: null, code, message: "m", retryable: false })).toMatchObject({
        status: "failed",
        code,
      });
    }
  });

  test("a timeout is uncertain; other network errors retry", () => {
    expect(outcomeFor({ error: new DOMException("timed out", "TimeoutError") })).toEqual({
      status: "uncertain",
      code: "timeout_uncertain",
      message: null,
    });
    expect(outcomeFor({ error: new TypeError("fetch failed") })).toEqual({
      status: "retry_pending",
      code: "network",
      message: "fetch failed",
    });
  });

  test("non-JSON or malformed replies retry as bad_response", () => {
    for (const body of ["<html>Sign in</html>", "", "null", "[]", '{"ok":true}', '{"ok":false,"code":"x"}']) {
      expect(outcomeFor({ body })).toEqual({ status: "retry_pending", code: "bad_response", message: null });
    }
  });

  test("long codes and messages are clipped", () => {
    const out = reply({ ok: false, code: "c".repeat(100), message: "m".repeat(500), retryable: false });
    expect(out.code).toHaveLength(60);
    expect(out.message).toHaveLength(300);
  });

  test("no address fails, a non-test recipient is skipped, others go", () => {
    expect(precheck({ ...row, recipient_email: null })).toEqual({ status: "failed", code: "no_email", message: null });
    expect(precheck({ ...row, test_only: true, allowed: false })).toEqual({
      status: "skipped",
      code: "not_test_recipient",
      message: null,
    });
    expect(precheck(row)).toBeNull();
  });
});
