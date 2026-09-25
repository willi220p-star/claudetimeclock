import { describe, expect, test } from "vitest";
import { canClockWithApp, decisionFor, needsConsentScreen, parseNotice } from "@/lib/consent";
import type { Consent } from "@/lib/daymark";

const base: Consent = { notice_version: "1.0", notice_acknowledged: true, location: "granted", selfie: "granted" };

describe("consent gate", () => {
  test("the notice must be acknowledged and both choices made", () => {
    expect(needsConsentScreen(base)).toBe(false);
    expect(needsConsentScreen({ ...base, notice_acknowledged: false })).toBe(true);
    expect(needsConsentScreen({ ...base, selfie: null })).toBe(true);
  });

  test("saying no is a choice; it routes to supervisor confirmation, not the consent screen", () => {
    const declined: Consent = { ...base, location: "refused", selfie: "withdrawn" };
    expect(needsConsentScreen(declined)).toBe(false);
    expect(canClockWithApp(declined)).toBe(false);
  });

  test("the app clocks only with both consents granted", () => {
    expect(canClockWithApp(base)).toBe(true);
    expect(canClockWithApp({ ...base, location: "refused" })).toBe(false);
  });
});

describe("decisionFor", () => {
  test.each([
    ["agree", null, "granted"],
    ["agree", "refused", "granted"],
    ["agree", "granted", null],
    ["decline", null, "refused"],
    ["decline", "granted", "withdrawn"],
    ["decline", "refused", null],
    ["decline", "withdrawn", null],
  ] as const)("%s after %s records %s", (choice, current, expected) => {
    expect(decisionFor(choice, current)).toBe(expected);
  });
});

describe("parseNotice", () => {
  test("splits paragraphs, headings and lists", () => {
    const body = "\nIntro line one\ncontinues here.\n\nWhat we collect\n\n- Your details: name.\n- Location: once.\n\nYou can say no.\n";
    expect(parseNotice(body)).toEqual([
      { kind: "paragraph", text: "Intro line one continues here." },
      { kind: "heading", text: "What we collect" },
      { kind: "list", items: ["Your details: name.", "Location: once."] },
      { kind: "paragraph", text: "You can say no." },
    ]);
  });

  test("markup in the body stays plain text", () => {
    expect(parseNotice("<script>alert(1)</script> is text.")).toEqual([
      { kind: "paragraph", text: "<script>alert(1)</script> is text." },
    ]);
  });
});
