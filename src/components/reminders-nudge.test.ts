import { describe, expect, it } from "vitest";
import { nudgeText } from "@/components/reminders-nudge";

describe("nudgeText", () => {
  it("nags only when reminders could still be turned on", () => {
    expect(nudgeText("off")).toMatch(/Turn on reminders/);
    expect(nudgeText("install")).toMatch(/Install DGK Clock first/);
    expect(nudgeText("blocked")).toMatch(/blocked/);
  });
  it("stays quiet when they're on or can't work here", () => {
    expect(nudgeText("on")).toBeNull();
    expect(nudgeText("unsupported")).toBeNull();
  });
});
