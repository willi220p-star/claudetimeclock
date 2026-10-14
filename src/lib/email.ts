/** Email notifications (D50): labels and checks for Settings → Notifications. */

export const EMAIL_KIND_LABELS: Record<string, string> = {
  request: "Request decisions and approvals",
  attendance: "Times to confirm",
  work_based: "Work-based days",
  announcement: "Announcements",
  schedule: "Roster changes",
  task: "Tasks and project updates",
  times: "Clock time changes",
  signoff: "Weeks to sign",
  digest: "Morning summary",
  escalated: "Escalations",
};

const ERROR_TEXT: Record<string, string> = {
  no_email: "No email address",
  not_test_recipient: "Not on the test list",
  quota_exceeded: "Gmail daily limit reached",
  timeout_uncertain: "Timed out — it may have been sent",
  bad_signature: "Secret doesn't match Apps Script",
  stale_request: "Clock mismatch",
  invalid_recipient: "Email address rejected",
  recipient_not_allowed: "Blocked by Apps Script test list",
  invalid_url: "Link not allowed",
  send_failed: "Gmail refused it",
  bad_response: "Apps Script returned an error page",
  network: "Couldn't reach Apps Script",
  max_attempts: "Gave up after 5 tries",
  stale_processing: "Stopped mid-send — may have been sent",
};

/** An outbox error code in plain words; unknown codes show as they came. */
export function emailErrorText(code: string | null | undefined) {
  if (!code) return "Unknown error";
  return Object.hasOwn(ERROR_TEXT, code) ? ERROR_TEXT[code] : code;
}

export const MAX_TEST_RECIPIENTS = 20;

/** The test-recipients box, one address per line: trimmed, lower-cased, de-duplicated. */
export function parseRecipients(text: string): { emails: string[]; error: string | null } {
  const emails = [
    ...new Set(
      text
        .split(/[\r\n]+/)
        .map((line) => line.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  const bad = emails.find((email) => !/^[^@\s]+@[^@\s]+$/.test(email));
  if (bad) return { emails, error: `"${bad}" isn't an email address.` };
  if (emails.length > MAX_TEST_RECIPIENTS) {
    return { emails, error: `Keep the test list to ${MAX_TEST_RECIPIENTS} addresses or fewer.` };
  }
  return { emails, error: null };
}

/** Whole number of emails a day the admin may set (Gmail allows about 100). */
export function dailyCap(text: string) {
  const value = Number(text.trim());
  return text.trim() !== "" && Number.isInteger(value) && value >= 1 && value <= 95 ? value : null;
}

export type EmailSettings = {
  enabled: boolean;
  kinds: string[];
  options: string[];
  testRecipients: string[];
  dailyCap: number;
  sentToday: number;
  queued: number;
  failed7d: number;
  uncertain7d: number;
};

/** email_settings() jsonb, read defensively. */
export function readEmailSettings(json: unknown): EmailSettings {
  const row = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;
  const strings = (value: unknown) => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);
  const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
  return {
    enabled: row.enabled === true,
    kinds: strings(row.kinds),
    options: strings(row.options),
    testRecipients: strings(row.test_recipients),
    dailyCap: number(row.daily_cap),
    sentToday: number(row.sent_today),
    queued: number(row.queued),
    failed7d: number(row.failed_7d),
    uncertain7d: number(row.uncertain_7d),
  };
}
