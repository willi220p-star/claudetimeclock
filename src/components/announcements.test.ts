import { describe, expect, it } from "vitest";
import { readSummary } from "@/components/announcements";

describe("readSummary", () => {
  it("counts reads, or acknowledgements when they're required", () => {
    expect(readSummary({ must_ack: false, recipients: 6, read: 4, acked: 0 })).toBe("4 of 6 read");
    expect(readSummary({ must_ack: true, recipients: 6, read: 5, acked: 3 })).toBe("3 of 6 acknowledged");
  });
});
