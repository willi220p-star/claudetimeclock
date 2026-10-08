import { describe, expect, test } from "vitest";
import { applyQueue, byTime, GESTURES, nextGesture, type QueuedItem } from "@/lib/offline-queue";

const base = { userId: "u", latitude: 0, longitude: 0, accuracy: 10, gesture: "g", photo: new Blob(), dayKind: null };
const clock = (id: string, action: "shift_in" | "break_start" | "break_end" | "shift_out", at: string): QueuedItem => ({
  ...base,
  id,
  kind: "clock",
  action,
  occurredAt: at,
});

describe("offline queue (D35)", () => {
  test("Home's state follows the clocks still waiting, in time order", () => {
    const items = [clock("b", "break_start", "2026-10-12T02:30:00Z"), clock("a", "shift_in", "2026-10-11T23:30:00Z")];
    expect(applyQueue("out", items)).toBe("break");
    expect(applyQueue("out", [])).toBe("out");
    expect(applyQueue("in", [clock("c", "shift_out", "2026-10-12T07:30:00Z")])).toBe("out");
    // A refused clock never happened as far as Home is concerned.
    expect(applyQueue("in", [{ ...clock("d", "shift_out", "2026-10-12T07:30:00Z"), refused: "No." }])).toBe("in");
  });

  test("a typed time and a work log go before the clock at the same moment", () => {
    const at = "2026-10-12T07:30:00Z";
    const log: QueuedItem = { id: "l", userId: "u", kind: "log", occurredAt: at, workDate: "2026-10-12", summary: "Did things" };
    const typed: QueuedItem = { id: "t", userId: "u", kind: "typed", occurredAt: at, event: "break_end", atTime: "13:00", note: null, dayKind: null };
    const out = clock("o", "shift_out", at);
    expect([out, log, typed].sort(byTime).map((item) => item.id)).toEqual(["t", "l", "o"]);
    expect(applyQueue("break", [out, log, typed])).toBe("out");
  });

  test("the phone picks a gesture from the server's list", () => {
    expect(nextGesture(() => 0)).toBe(GESTURES[0]);
    expect(nextGesture(() => 0.999)).toBe(GESTURES.at(-1));
  });
});
