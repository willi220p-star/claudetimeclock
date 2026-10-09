import { describe, expect, it } from "vitest";
import { APPEARANCE_SCRIPT, parseAppearance } from "@/lib/appearance";

describe("parseAppearance", () => {
  it("defaults when nothing or junk is saved", () => {
    const defaults = { theme: "system", text: "normal" };
    expect(parseAppearance(null)).toEqual(defaults);
    expect(parseAppearance("not json")).toEqual(defaults);
    expect(parseAppearance('{"theme":"neon","text":9}')).toEqual(defaults);
  });
  it("keeps valid choices", () => {
    expect(parseAppearance('{"theme":"dark","text":"larger"}')).toEqual({ theme: "dark", text: "larger" });
  });
  it("the head script reads the same key", () => {
    expect(APPEARANCE_SCRIPT).toContain("dgk-appearance");
  });
});
