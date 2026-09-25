import type { Consent, ConsentDecision } from "@/lib/daymark";

export type ConsentPurpose = "location" | "selfie";
export type ConsentChoice = "agree" | "decline";

/** Security review §2.4: interns see the notice and choose before any clocking. */
export function needsConsentScreen(consent: Consent) {
  return !consent.notice_acknowledged || consent.location === null || consent.selfie === null;
}

/** Clocking with GPS and a selfie needs both, granted. Otherwise it's supervisor confirmation. */
export function canClockWithApp(consent: Consent) {
  return consent.notice_acknowledged && consent.location === "granted" && consent.selfie === "granted";
}

export function choiceOf(decision: ConsentDecision | null): ConsentChoice | null {
  if (decision === null) return null;
  return decision === "granted" ? "agree" : "decline";
}

/** The decision to record for a choice, or null when nothing changes. Saying no after yes is a withdrawal. */
export function decisionFor(choice: ConsentChoice, current: ConsentDecision | null): ConsentDecision | null {
  if (choice === "agree") return current === "granted" ? null : "granted";
  if (current === "granted") return "withdrawn";
  return current === null ? "refused" : null;
}

export type NoticeBlock =
  | { kind: "heading"; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; items: string[] };

/**
 * The notice body is plain text: blank lines split blocks, lines starting "- " are list items,
 * and a one-line block without closing punctuation is a heading. Rendered as React elements only.
 */
export function parseNotice(body: string): NoticeBlock[] {
  return body
    .trim()
    .split(/\n\s*\n/)
    .map((block) => block.split("\n").map((line) => line.trim()).filter(Boolean))
    .filter((lines) => lines.length > 0)
    .map((lines): NoticeBlock => {
      if (lines.every((line) => line.startsWith("- "))) {
        return { kind: "list", items: lines.map((line) => line.slice(2).trim()) };
      }
      const text = lines.join(" ");
      if (lines.length === 1 && text.length <= 60 && !/[.!?:)]$/.test(text)) return { kind: "heading", text };
      return { kind: "paragraph", text };
    });
}
