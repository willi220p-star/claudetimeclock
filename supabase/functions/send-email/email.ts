// Pure parts of send-email (D50); email.test.ts runs them under Vitest. No Deno APIs here.
// Contract: docs/superpowers/specs/2026-10-14-email-notifications-contract.md.

/** A row from public.email_claim. */
export type Claimed = {
  id: string;
  correlation_id: string;
  template_id: string;
  recipient_category: "user" | "admin";
  kind: string;
  title: string;
  body: string;
  link: string | null;
  created_at: string;
  attempts: number;
  recipient_name: string | null;
  recipient_email: string | null;
  test_only: boolean;
  allowed: boolean;
};

export type MarkStatus = "sent" | "retry_pending" | "failed" | "uncertain" | "skipped";
export type Outcome = { status: MarkStatus; code: string | null; message: string | null };

/** The exact bytes Apps Script checks: "v1." + ts + "." + event_id + "." + payload. */
export function canonicalString(ts: number, eventId: string, payload: string) {
  return `v1.${ts}.${eventId}.${payload}`;
}

/** Lowercase hex HMAC-SHA-256 with Web Crypto (Deno and Node 22 alike). */
export async function sign(secret: string, message: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
  return Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** APP_BASE_URL + the in-app path; anything but a relative "/…" link opens the notifications page. */
export function buildActionUrl(base: string, link: string | null) {
  if (!/^https:\/\/[^\s/]+/.test(base)) throw new Error("APP_BASE_URL must be an https:// address");
  const path = link && link.startsWith("/") && !link.startsWith("//") ? link : "/notifications";
  return base.replace(/\/+$/, "") + path;
}

/** "Tue 14 Oct, 9:05 am" in Darwin time. */
export function formatDarwin(at: string | Date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-AU", {
      timeZone: "Australia/Darwin",
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
      .formatToParts(new Date(at))
      .map((p) => [p.type, p.value]),
  );
  return `${parts.weekday} ${parts.day} ${parts.month}, ${parts.hour}:${parts.minute} ${String(parts.dayPeriod).toLowerCase()}`;
}

/** The signed payload: exactly the contract's fields, nothing else from the row. */
export function buildPayload(row: Claimed, base: string) {
  return JSON.stringify({
    event_id: row.id,
    correlation_id: row.correlation_id,
    template_id: row.template_id,
    recipient_category: row.recipient_category,
    to: row.recipient_email,
    data: {
      recipient_name: row.recipient_name ?? "",
      event_title: row.title,
      event_message: row.body,
      action_url: buildActionUrl(base, row.link),
      event_timestamp: formatDarwin(row.created_at),
    },
  });
}

/** The POST body for Apps Script (doPost can't read headers, so the signature rides in the body). */
export async function buildRequest(row: Claimed, base: string, secret: string, now = Date.now()) {
  const ts = Math.floor(now / 1000);
  const payload = buildPayload(row, base);
  const sig = await sign(secret, canonicalString(ts, row.id, payload));
  return JSON.stringify({ v: 1, ts, event_id: row.id, payload, sig });
}

/** Rows that never go to Apps Script. */
export function precheck(row: Claimed): Outcome | null {
  if (!row.recipient_email) return { status: "failed", code: "no_email", message: null };
  if (!row.allowed) return { status: "skipped", code: "not_test_recipient", message: null };
  return null;
}

const clip = (value: unknown, n: number) => (typeof value === "string" && value ? value.slice(0, n) : null);

/** What a send attempt means for the outbox row. A timeout may have sent, so it is never retried on its own. */
export function outcomeFor(result: { body: string } | { error: unknown }): Outcome {
  if ("error" in result) {
    const name = (result.error as { name?: string } | null)?.name;
    if (name === "TimeoutError") return { status: "uncertain", code: "timeout_uncertain", message: null };
    return { status: "retry_pending", code: "network", message: clip(String((result.error as Error)?.message ?? ""), 300) };
  }
  let reply: unknown;
  try {
    reply = JSON.parse(result.body);
  } catch {
    return { status: "retry_pending", code: "bad_response", message: null };
  }
  const r = reply as { ok?: unknown; status?: unknown; code?: unknown; message?: unknown; retryable?: unknown } | null;
  if (r && r.ok === true && (r.status === "sent" || r.status === "duplicate")) {
    return { status: "sent", code: null, message: null };
  }
  if (r && r.ok === false && typeof r.retryable === "boolean") {
    return {
      status: r.retryable ? "retry_pending" : "failed",
      code: clip(r.code, 60) ?? "unknown",
      message: clip(r.message, 300),
    };
  }
  return { status: "retry_pending", code: "bad_response", message: null };
}
