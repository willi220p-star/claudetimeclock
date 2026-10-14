import { describe, expect, test } from "vitest";
import { dailyCap, emailErrorText, parseRecipients, readEmailSettings } from "@/lib/email";

describe("emailErrorText", () => {
  test("known codes in plain words", () => {
    expect(emailErrorText("quota_exceeded")).toBe("Gmail daily limit reached");
    expect(emailErrorText("stale_processing")).toBe("Stopped mid-send — may have been sent");
  });
  test("unknown codes as they came, never prototype keys", () => {
    expect(emailErrorText("weird_code")).toBe("weird_code");
    expect(emailErrorText("constructor")).toBe("constructor");
    expect(emailErrorText(null)).toBe("Unknown error");
  });
});

describe("parseRecipients", () => {
  test("trims, lower-cases, drops blanks and duplicates", () => {
    expect(parseRecipients("  A@x.com \n\n a@X.com\r\nb@y.org ")).toEqual({ emails: ["a@x.com", "b@y.org"], error: null });
    expect(parseRecipients("")).toEqual({ emails: [], error: null });
  });
  test("rejects lines without @ or with spaces", () => {
    expect(parseRecipients("nope").error).toMatch(/"nope" isn't an email address/);
    expect(parseRecipients("a b@x.com").error).toMatch(/isn't an email address/);
  });
  test("at most 20", () => {
    const lines = Array.from({ length: 21 }, (_, i) => `p${i}@x.com`).join("\n");
    expect(parseRecipients(lines).error).toMatch(/20/);
    expect(parseRecipients(lines.split("\n").slice(0, 20).join("\n")).error).toBeNull();
  });
});

test("dailyCap is a whole number from 1 to 95", () => {
  expect(dailyCap("80")).toBe(80);
  expect(dailyCap("1")).toBe(1);
  expect(dailyCap("95")).toBe(95);
  for (const bad of ["", "0", "96", "2.5", "x"]) expect(dailyCap(bad)).toBeNull();
});

test("readEmailSettings tolerates missing fields", () => {
  expect(readEmailSettings(null)).toMatchObject({ enabled: false, kinds: [], dailyCap: 0 });
  expect(readEmailSettings({ enabled: true, kinds: ["task", 3], daily_cap: 80, test_recipients: ["a@x.com"] })).toMatchObject({
    enabled: true,
    kinds: ["task"],
    dailyCap: 80,
    testRecipients: ["a@x.com"],
  });
});
