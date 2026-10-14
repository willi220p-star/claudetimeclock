import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { TEMPLATES, render, MESSAGE_MAX } = require("./Templates.js");

const data = {
  recipient_name: "Sam",
  event_title: "Leave approved",
  event_message: "Your leave for Friday was approved.",
  action_url: "https://willi220p-star.github.io/claudetimeclock/requests",
  event_timestamp: "Tue 14 Oct, 9:05 am",
};

describe("TEMPLATES", () => {
  it("has the six templates with the right categories", () => {
    expect(Object.keys(TEMPLATES).sort()).toEqual(
      ["announcement", "approval_needed", "general_notice", "request_update", "roster_change", "task_update"],
    );
    expect(TEMPLATES.request_update.categories).toEqual(["user"]);
    expect(TEMPLATES.approval_needed.categories).toEqual(["admin"]);
    for (const t of Object.values(TEMPLATES)) {
      expect(t.version).toBe(1);
      expect(t.required).toEqual(["recipient_name", "event_title", "event_message", "action_url", "event_timestamp"]);
    }
  });
});

describe("render", () => {
  it("renders plain text with every value and no HTML", () => {
    const m = render(TEMPLATES.request_update, data);
    expect(m.subject).toBe("DGK Clock: Leave approved");
    expect(m.text).toContain("Hi Sam,");
    expect(m.text).toContain("Your leave for Friday was approved.");
    expect(m.text).toContain("Open DGK Clock: " + data.action_url);
    expect(m.text).toContain("Turn them off on Me in DGK Clock.");
    expect(m.text).not.toMatch(/<[a-z]/i);
    expect(m.text).not.toContain("{{");
  });

  it("HTML-escapes every value in html", () => {
    const m = render(TEMPLATES.announcement, {
      ...data,
      recipient_name: "<b>Sam</b>",
      event_message: `<script>alert("x")</script> & 'q'`,
    });
    expect(m.html).not.toContain("<script>");
    expect(m.html).not.toContain("<b>Sam</b>");
    expect(m.html).toContain("&lt;b&gt;Sam&lt;/b&gt;");
    expect(m.html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;q&#39;");
    expect(m.html).toContain('href="' + data.action_url + '"');
    expect(m.html).toContain("#3859f9");
  });

  it("throws bad_request when a required field is missing or empty", () => {
    for (const key of TEMPLATES.general_notice.required) {
      const d = { ...data };
      delete d[key];
      expect(() => render(TEMPLATES.general_notice, d)).toThrow(/missing field/);
      expect(() => render(TEMPLATES.general_notice, { ...data, [key]: " " })).toThrow();
      expect(() => render(TEMPLATES.general_notice, { ...data, [key]: 5 })).toThrow();
    }
    try {
      render(TEMPLATES.general_notice, {});
    } catch (e) {
      expect(e.code).toBe("bad_request");
    }
  });

  it("rejects an over-long title", () => {
    expect(() => render(TEMPLATES.general_notice, { ...data, event_title: "x".repeat(201) })).toThrow(/too long/);
  });

  it("strips CR/LF from the subject", () => {
    const m = render(TEMPLATES.general_notice, { ...data, event_title: "Hi\r\nBcc: evil@example.com" });
    expect(m.subject).not.toMatch(/[\r\n]/);
    expect(m.subject).toBe("DGK Clock: Hi Bcc: evil@example.com");
  });

  it("truncates a long message", () => {
    const m = render(TEMPLATES.general_notice, { ...data, event_message: "a".repeat(5000) });
    expect(m.text).toContain("a".repeat(MESSAGE_MAX - 1) + "…");
    expect(m.text).not.toContain("a".repeat(MESSAGE_MAX));
  });

  it("does not expand placeholders that appear inside data", () => {
    const m = render(TEMPLATES.general_notice, { ...data, event_message: "{{recipient_name}} {{secret}}" });
    expect(m.text).toContain("{{recipient_name}} {{secret}}");
  });
});
