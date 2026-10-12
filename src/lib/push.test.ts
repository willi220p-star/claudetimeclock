import { describe, expect, test, vi } from "vitest";

vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));
const { shouldRelink } = await import("@/lib/push");

const base = { supported: true, permission: "granted" as NotificationPermission | null, subscribed: false };

describe("shouldRelink (D45)", () => {
  test("allowed but no subscription: re-link quietly", () => {
    expect(shouldRelink(base)).toBe(true);
  });
  test("never without permission, support, or when already subscribed", () => {
    expect(shouldRelink({ ...base, permission: "default" })).toBe(false);
    expect(shouldRelink({ ...base, permission: "denied" })).toBe(false);
    expect(shouldRelink({ ...base, permission: null })).toBe(false);
    expect(shouldRelink({ ...base, supported: false })).toBe(false);
    expect(shouldRelink({ ...base, subscribed: true })).toBe(false);
  });
});
