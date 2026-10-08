import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));
const { isNetworkError } = await import("@/lib/offline-sync");

afterEach(() => vi.restoreAllMocks());

describe("isNetworkError", () => {
  test("no signal keeps the clock; a database refusal doesn't", () => {
    expect(isNetworkError({ message: "TypeError: Failed to fetch" })).toBe(true);
    expect(isNetworkError(new TypeError("Load failed"))).toBe(true);
    expect(isNetworkError({ message: "Clock in before you clock out.", code: "P0001" })).toBe(false);
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    expect(isNetworkError({ message: "anything" })).toBe(true);
  });
});
