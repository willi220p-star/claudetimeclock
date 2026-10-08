// Pure parts of send-push; push.test.ts runs them under Vitest.

export type Due = {
  outbox_id: number;
  attempts: number;
  endpoint: string;
  p256dh: string;
  auth: string;
  title: string;
  body: string;
  link: string | null;
};

/** What the service worker shows: title, text and the in-app path to open. */
export function payload(row: Due) {
  return JSON.stringify({ title: row.title, body: row.body, link: row.link ?? "/notifications" });
}

/** A gone subscription (the person turned notifications off or reinstalled) is removed, not retried. */
export function outcome(status: number | null): "sent" | "gone" | "retry" {
  if (status !== null && status >= 200 && status < 300) return "sent";
  if (status === 404 || status === 410) return "gone";
  return "retry";
}
