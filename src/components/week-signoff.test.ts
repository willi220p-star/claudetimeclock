import { describe, expect, it } from "vitest";
import { signoffState } from "@/components/week-signoff";

const signed = { placement_id: "p", week_start: "2026-10-05", signed_by_name: "Priya", signed_at: "2026-10-13T06:40:00Z", counted_minutes: 900 };

describe("signoffState", () => {
  it("can't sign a week until the next Monday (Darwin)", () => {
    expect(signoffState("2026-10-05", "2026-10-11", null)).toBe("not_ended");
    expect(signoffState("2026-10-05", "2026-10-12", null)).toBe("can_sign");
    expect(signoffState("2026-09-28", "2026-10-12", undefined)).toBe("can_sign");
  });

  it("a live sign-off wins", () => {
    expect(signoffState("2026-10-05", "2026-10-14", signed)).toBe("signed");
  });
});
