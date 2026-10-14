import { createHmac } from "node:crypto";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { handle, safeEqual_ } = require("./Code.js");

const SECRET = "test-secret-0123456789";
const NOW_MS = 1_760_400_000_000;
const TS = NOW_MS / 1000;
const ID = "11111111-2222-4333-8444-555555555555";

const hmacHex = (message, key) => createHmac("sha256", Buffer.from(key, "utf8")).update(message, "utf8").digest("hex");

function payload(over = {}) {
  return {
    event_id: ID,
    correlation_id: "99999999-2222-4333-8444-555555555555",
    template_id: "request_update",
    recipient_category: "user",
    to: "sam@example.com",
    data: {
      recipient_name: "Sam",
      event_title: "Leave approved",
      event_message: "Your leave was approved.",
      action_url: "https://willi220p-star.github.io/claudetimeclock/requests",
      event_timestamp: "Tue 14 Oct, 9:05 am",
    },
    ...over,
  };
}

function envelope({ p = payload(), ts = TS, id = ID, secret = SECRET, sig, payloadText } = {}) {
  const text = payloadText ?? JSON.stringify(p);
  return JSON.stringify({ v: 1, ts, event_id: id, payload: text, sig: sig ?? hmacHex(`v1.${ts}.${id}.${text}`, secret) });
}

function fakeDeps(over = {}) {
  const sent = [];
  const logs = [];
  const store = new Map();
  const lock = { held: false, released: 0, tryLock: () => true, releaseLock() { this.released++; } };
  const deps = {
    now: () => NOW_MS,
    props: { SHARED_SECRET: SECRET },
    hmacHex,
    mail: { remaining: () => 100, send: (m) => sent.push(m) },
    cache: { get: (k) => store.get(k) ?? null, put: (k, v) => store.set(k, v) },
    lock,
    log: (o) => logs.push(o),
    ...over,
  };
  return { deps, sent, logs, store, lock };
}

describe("handle", () => {
  it("sends on a valid signature and caches the event id", () => {
    const { deps, sent, store, lock, logs } = fakeDeps();
    const res = handle(envelope(), deps);
    expect(res).toEqual({ ok: true, event_id: ID, status: "sent" });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: "sam@example.com", subject: "DGK Clock: Leave approved", name: "DGK Clock" });
    expect(sent[0].htmlBody).toContain("Open DGK Clock");
    expect(store.get(`sent:${ID}`)).toBe("1");
    expect(lock.released).toBe(1);
    expect(logs).toEqual([{ event_id: ID, template_id: "request_update", category: "user", status: "sent", code: null }]);
  });

  it("uses SENDER_NAME when set", () => {
    const { deps, sent } = fakeDeps();
    deps.props.SENDER_NAME = "DGK Team";
    handle(envelope(), deps);
    expect(sent[0].name).toBe("DGK Team");
  });

  it("rejects a bad signature without sending", () => {
    const { deps, sent } = fakeDeps();
    const res = handle(envelope({ secret: "wrong" }), deps);
    expect(res).toMatchObject({ ok: false, event_id: ID, code: "bad_signature", retryable: false });
    expect(sent).toHaveLength(0);
  });

  it("rejects a payload altered after signing", () => {
    const { deps } = fakeDeps();
    const env = JSON.parse(envelope());
    env.payload = env.payload.replace("sam@", "eve@");
    expect(handle(JSON.stringify(env), deps).code).toBe("bad_signature");
  });

  it("rejects an expired or future timestamp", () => {
    const { deps } = fakeDeps();
    expect(handle(envelope({ ts: TS - 301 }), deps)).toMatchObject({ code: "stale_request", retryable: false });
    expect(handle(envelope({ ts: TS + 301 }), deps).code).toBe("stale_request");
    expect(handle(envelope({ ts: TS - 300 }), deps).ok).toBe(true);
  });

  it.each([
    ["not json", "{"],
    ["wrong version", JSON.stringify({ v: 2, ts: TS, event_id: ID, payload: "{}", sig: "a".repeat(64) })],
    ["ts as string", JSON.stringify({ v: 1, ts: String(TS), event_id: ID, payload: "{}", sig: "a".repeat(64) })],
    ["bad event id", JSON.stringify({ v: 1, ts: TS, event_id: "x", payload: "{}", sig: "a".repeat(64) })],
    ["payload object", JSON.stringify({ v: 1, ts: TS, event_id: ID, payload: {}, sig: "a".repeat(64) })],
    ["payload too big", JSON.stringify({ v: 1, ts: TS, event_id: ID, payload: "x".repeat(20001), sig: "a".repeat(64) })],
    ["short sig", JSON.stringify({ v: 1, ts: TS, event_id: ID, payload: "{}", sig: "abc" })],
  ])("rejects a malformed envelope (%s)", (_name, raw) => {
    const { deps, sent } = fakeDeps();
    expect(handle(raw, deps)).toMatchObject({ ok: false, code: "bad_request", retryable: false });
    expect(sent).toHaveLength(0);
  });

  it("rejects a malformed payload after a valid signature", () => {
    const { deps } = fakeDeps();
    expect(handle(envelope({ payloadText: "not json" }), deps)).toMatchObject({ code: "bad_request", event_id: ID });
    expect(handle(envelope({ payloadText: "null" }), deps).code).toBe("bad_request");
  });

  it("rejects an event_id mismatch", () => {
    const { deps } = fakeDeps();
    const p = payload({ event_id: "22222222-2222-4333-8444-555555555555" });
    expect(handle(envelope({ p }), deps)).toMatchObject({ code: "bad_request", retryable: false });
  });

  it("rejects an unknown template", () => {
    const { deps } = fakeDeps();
    expect(handle(envelope({ p: payload({ template_id: "nope" }) }), deps)).toMatchObject({ code: "unknown_template", retryable: false });
    expect(handle(envelope({ p: payload({ template_id: "__proto__" }) }), deps).code).toBe("unknown_template");
  });

  it("rejects a category the template does not allow", () => {
    const { deps, sent } = fakeDeps();
    expect(handle(envelope({ p: payload({ recipient_category: "admin" }) }), deps).code).toBe("bad_request");
    expect(handle(envelope({ p: payload({ template_id: "approval_needed" }) }), deps).code).toBe("bad_request");
    expect(handle(envelope({ p: payload({ recipient_category: "root" }) }), deps).code).toBe("bad_request");
    expect(sent).toHaveLength(0);
  });

  it.each([
    "not-an-email",
    "a@b.com, c@d.com",
    "a@b.com\nBcc: c@d.com",
    "a b@c.com",
    `${"x".repeat(250)}@b.com`,
  ])("rejects a bad recipient %#", (to) => {
    const { deps } = fakeDeps();
    expect(handle(envelope({ p: payload({ to }) }), deps)).toMatchObject({ code: "invalid_recipient", retryable: false });
  });

  it("never echoes the recipient, secret or signature", () => {
    const { deps } = fakeDeps();
    const raw = envelope({ p: payload({ to: "a@b.com, c@d.com" }) });
    const out = JSON.stringify(handle(raw, deps));
    expect(out).not.toContain("a@b.com");
    expect(out).not.toContain(SECRET);
    expect(out).not.toContain(JSON.parse(raw).sig);
  });

  it("enforces ALLOWED_RECIPIENTS case-insensitively", () => {
    const { deps, sent } = fakeDeps();
    deps.props.ALLOWED_RECIPIENTS = " Dilip@Example.com , other@example.com ";
    expect(handle(envelope(), deps)).toMatchObject({ code: "recipient_not_allowed", retryable: false });
    expect(sent).toHaveLength(0);
    expect(handle(envelope({ p: payload({ to: "dilip@example.COM" }) }), deps).ok).toBe(true);
  });

  it("rejects an action_url outside the allowed prefix", () => {
    const { deps } = fakeDeps();
    const bad = (action_url) => envelope({ p: payload({ data: { ...payload().data, action_url } }) });
    expect(handle(bad("https://evil.example.com/claudetimeclock/"), deps)).toMatchObject({ code: "invalid_url", retryable: false });
    expect(handle(bad("https://willi220p-star.github.io/other/"), deps).code).toBe("invalid_url");
    expect(handle(bad('https://willi220p-star.github.io/claudetimeclock/"><x'), deps).code).toBe("invalid_url");
    deps.props.ALLOWED_URL_PREFIX = "https://example.com/app/";
    expect(handle(bad("https://example.com/app/x"), deps).ok).toBe(true);
  });

  it("rejects missing required data fields", () => {
    const { deps, sent } = fakeDeps();
    const data = { ...payload().data };
    delete data.event_title;
    expect(handle(envelope({ p: payload({ data }) }), deps)).toMatchObject({ code: "bad_request", retryable: false });
    expect(sent).toHaveLength(0);
  });

  it("returns duplicate without sending when the event id is cached", () => {
    const { deps, sent, store, lock } = fakeDeps();
    store.set(`sent:${ID}`, "1");
    expect(handle(envelope(), deps)).toEqual({ ok: true, event_id: ID, status: "duplicate" });
    expect(sent).toHaveLength(0);
    expect(lock.released).toBe(1);
  });

  it("a second identical request is a duplicate", () => {
    const { deps, sent } = fakeDeps();
    handle(envelope(), deps);
    expect(handle(envelope(), deps).status).toBe("duplicate");
    expect(sent).toHaveLength(1);
  });

  it("returns quota_exceeded (retryable) when quota is 0", () => {
    const { deps, sent, store } = fakeDeps();
    deps.mail.remaining = () => 0;
    expect(handle(envelope(), deps)).toMatchObject({ ok: false, code: "quota_exceeded", retryable: true });
    expect(sent).toHaveLength(0);
    expect(store.size).toBe(0);
  });

  it("returns send_failed (retryable) when MailApp throws, and does not cache", () => {
    const { deps, store, lock } = fakeDeps();
    deps.mail.send = () => {
      throw new Error("Service invoked too many times: sam@example.com");
    };
    const res = handle(envelope(), deps);
    expect(res).toMatchObject({ ok: false, code: "send_failed", retryable: true });
    expect(JSON.stringify(res)).not.toContain("sam@example.com");
    expect(store.size).toBe(0);
    expect(lock.released).toBe(1);
  });

  it("still reports sent when the cache write fails after sending", () => {
    const { deps } = fakeDeps();
    deps.cache.put = () => {
      throw new Error("cache down");
    };
    expect(handle(envelope(), deps).status).toBe("sent");
  });

  it("returns busy (retryable) when the lock is not acquired", () => {
    const { deps, sent, lock } = fakeDeps();
    lock.tryLock = () => false;
    expect(handle(envelope(), deps)).toMatchObject({ ok: false, code: "busy", retryable: true });
    expect(sent).toHaveLength(0);
    expect(lock.released).toBe(0);
  });

  it("returns server_misconfigured (retryable) when SHARED_SECRET is missing", () => {
    const { deps, sent } = fakeDeps({ props: {} });
    expect(handle(envelope(), deps)).toMatchObject({ ok: false, event_id: ID, code: "server_misconfigured", retryable: true });
    expect(sent).toHaveLength(0);
  });

  it("logs only the allowed fields", () => {
    const { deps, logs } = fakeDeps();
    handle(envelope({ secret: "wrong" }), deps);
    expect(logs).toEqual([{ event_id: ID, template_id: null, category: null, status: "error", code: "bad_signature" }]);
  });
});

describe("safeEqual_", () => {
  it("compares strings", () => {
    expect(safeEqual_("abc", "abc")).toBe(true);
    expect(safeEqual_("abc", "abd")).toBe(false);
    expect(safeEqual_("abc", "ab")).toBe(false);
    expect(safeEqual_(undefined, "ab")).toBe(false);
  });
});
