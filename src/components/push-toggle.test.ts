import { describe, expect, test, vi } from "vitest";

vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));
const { pushState } = await import("@/components/push-toggle");

const base = { supported: true, ios: false, installed: false, permission: "default" as NotificationPermission, subscribed: false };

describe("pushState (D36)", () => {
  test("iPhone needs the installed app first", () => {
    expect(pushState({ ...base, ios: true })).toBe("install");
    expect(pushState({ ...base, ios: true, installed: true })).toBe("off");
  });
  test("unsupported, blocked, off and on", () => {
    expect(pushState({ ...base, supported: false })).toBe("unsupported");
    expect(pushState({ ...base, permission: "denied" })).toBe("blocked");
    expect(pushState(base)).toBe("off");
    expect(pushState({ ...base, permission: "granted", subscribed: true })).toBe("on");
  });
});
