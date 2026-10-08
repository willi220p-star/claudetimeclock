import { afterEach, describe, expect, test, vi } from "vitest";
import type { QueuedItem } from "@/lib/offline-queue";

const rpc = vi.fn();
const listQueue = vi.fn();
const addToQueue = vi.fn();
const removeFromQueue = vi.fn();
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc }) }));
vi.mock("@/lib/offline-queue", () => ({ listQueue, addToQueue, removeFromQueue }));
const { isNetworkError, syncQueue, syncVerdict } = await import("@/lib/offline-sync");

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

describe("isNetworkError", () => {
  test("no signal keeps the clock; a database refusal doesn't", () => {
    expect(isNetworkError({ message: "TypeError: Failed to fetch" })).toBe(true);
    expect(isNetworkError(new TypeError("Load failed"))).toBe(true);
    expect(isNetworkError({ message: "Clock in before you clock out.", code: "P0001" })).toBe(false);
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    expect(isNetworkError({ message: "anything" })).toBe(true);
  });
});

describe("syncVerdict", () => {
  test("only the database's own refusal codes set an item aside", () => {
    for (const code of ["22023", "42501", "P0001"]) expect(syncVerdict({ message: "No.", code })).toBe("refused");
  });

  test("consent stops the sync; a day-type question, a 5xx, a captive portal or no code keeps the item", () => {
    expect(syncVerdict({ message: "Acknowledge the notice.", code: "P0001", hint: "consent" })).toBe("consent");
    expect(syncVerdict({ message: "Pick the day type.", code: "P0001", hint: "day_kind" })).toBe("retry");
    expect(syncVerdict({ message: "Bad gateway", code: "502" })).toBe("retry");
    expect(syncVerdict({ message: "Unexpected token '<'", code: "PGRST116" })).toBe("retry");
    expect(syncVerdict(new SyntaxError("Unexpected token '<'"))).toBe("retry");
    expect(syncVerdict({ message: "TypeError: Failed to fetch", code: "" })).toBe("retry");
    expect(syncVerdict(null)).toBe("retry");
  });
});

describe("syncQueue", () => {
  const typed: QueuedItem = {
    id: "t",
    userId: "u",
    kind: "typed",
    occurredAt: "2026-10-12T23:30:00.000Z",
    event: "shift_in",
    atTime: "09:00",
    note: null,
    dayKind: "full_day",
  };
  const log: QueuedItem = { id: "l", userId: "u", kind: "log", occurredAt: "2026-10-13T07:00:00Z", workDate: "2026-10-13", summary: "Did things" };
  const later: QueuedItem = { ...log, id: "l2", occurredAt: "2026-10-13T08:00:00Z" };
  const old: QueuedItem = { ...log, id: "r", refused: "Already refused." };

  test("typed times go on their own day; a refusal is kept aside; a 5xx keeps the rest waiting", async () => {
    listQueue.mockResolvedValue([old, typed, log, later]);
    rpc
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: { message: "Clock in first.", code: "P0001" } })
      .mockResolvedValueOnce({ error: { message: "Service unavailable", code: "503" } });

    expect(await syncQueue("u")).toEqual({ sent: 1, refused: 1, waiting: 1, consent: false });
    expect(rpc).toHaveBeenCalledTimes(3); // the already-refused item isn't sent again
    expect(rpc).toHaveBeenNthCalledWith(1, "submit_offline_typed", {
      offline_id: "t",
      event: "shift_in",
      at: "2026-10-12T23:30:00.000Z",
      note: undefined,
      day_kind: "full_day",
    });
    expect(removeFromQueue).toHaveBeenCalledExactlyOnceWith("t");
    expect(addToQueue).toHaveBeenCalledExactlyOnceWith({ ...log, refused: "Clock in first." });
  });

  test("a consent refusal stops the sync and keeps everything", async () => {
    listQueue.mockResolvedValue([typed, log]);
    rpc.mockResolvedValue({ error: { message: "Acknowledge the notice.", code: "42501", hint: "consent" } });
    expect(await syncQueue("u")).toEqual({ sent: 0, refused: 0, waiting: 2, consent: true });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(addToQueue).not.toHaveBeenCalled();
    expect(removeFromQueue).not.toHaveBeenCalled();
  });

  test("one run per person at a time", async () => {
    listQueue.mockResolvedValue([]);
    const first = syncQueue("a");
    expect(syncQueue("a")).toBe(first);
    expect(syncQueue("b")).not.toBe(first);
    await first;
    expect(syncQueue("a")).not.toBe(first);
  });
});
