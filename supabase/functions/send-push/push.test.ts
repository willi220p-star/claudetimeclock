// Runs under Vitest (no Deno here); push.ts is plain TypeScript.
import { describe, expect, test } from "vitest";
import { outcome, payload } from "./push";

describe("send-push", () => {
  test("payload carries title, body and a link", () => {
    const row = { outbox_id: 1, attempts: 0, endpoint: "https://x", p256dh: "k", auth: "a", title: "T", body: "B", link: null };
    expect(JSON.parse(payload(row))).toEqual({ title: "T", body: "B", link: "/notifications" });
  });

  test("404 and 410 drop the phone; other failures retry", () => {
    expect(outcome(201)).toBe("sent");
    expect(outcome(410)).toBe("gone");
    expect(outcome(404)).toBe("gone");
    expect(outcome(500)).toBe("retry");
    expect(outcome(null)).toBe("retry");
  });
});
