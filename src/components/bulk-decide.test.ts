import { describe, expect, test, vi } from "vitest";

vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));
const { decideEach } = await import("@/components/bulk-decide");

describe("decideEach", () => {
  test("decides every item in order and reports the ones that failed", async () => {
    const seen: number[] = [];
    const outcome = await decideEach(
      [1, 2, 3],
      (n) => `Item ${n}`,
      async (n) => {
        seen.push(n);
        return { error: n === 2 ? { message: "Office is full that day." } : null };
      },
    );
    expect(seen).toEqual([1, 2, 3]);
    expect(outcome).toEqual({ done: 2, failed: [{ label: "Item 2", message: "Office is full that day." }] });
  });
});
