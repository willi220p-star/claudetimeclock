import { describe, expect, test } from "vitest";
import { segmentPlan } from "@/app/clock/clock-sheet";

describe("segmentPlan (8 Oct: any segment, any time)", () => {
  test("not clocked in: Break and Finish ask when you arrived first", () => {
    expect(segmentPlan("start", "out")).toEqual({ action: "shift_in", missed: null });
    expect(segmentPlan("break", "out")).toEqual({ action: "break_start", missed: "shift_in" });
    expect(segmentPlan("finish", "out")).toEqual({ action: "shift_out", missed: "shift_in" });
  });
  test("on a break: Start or Break ends it; Finish asks when it ended", () => {
    expect(segmentPlan("start", "break")).toEqual({ action: "break_end", missed: null });
    expect(segmentPlan("break", "break")).toEqual({ action: "break_end", missed: null });
    expect(segmentPlan("finish", "break")).toEqual({ action: "shift_out", missed: "break_end" });
  });
  test("clocked in: Start is the only thing you can't do", () => {
    expect(segmentPlan("start", "in")).toBeNull();
    expect(segmentPlan("break", "in")).toEqual({ action: "break_start", missed: null });
    expect(segmentPlan("finish", "in")).toEqual({ action: "shift_out", missed: null });
  });
});
