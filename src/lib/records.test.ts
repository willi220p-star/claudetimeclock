import { describe, expect, test } from "vitest";
import {
  changedPatch,
  columnLabel,
  displayValue,
  fileBatches,
  formatBytes,
  inputValue,
  rowKey,
  tablesFor,
  type Names,
} from "@/lib/records";

const names: Names = {
  person: (id) => (id === "p1" ? "Anna Lee" : null),
  placement: (id) => (id === "pl1" ? "Anna Lee" : null),
};

describe("records", () => {
  test("supervisors don't see admin-only tables", () => {
    const admin = tablesFor(true).map((t) => t.table);
    const supervisor = tablesFor(false).map((t) => t.table);
    expect(admin).toContain("daymark_audit_log");
    expect(supervisor).not.toContain("daymark_audit_log");
    expect(supervisor).not.toContain("daymark_consent_records");
    expect(supervisor).toContain("daymark_punches");
  });

  test("the audit log and consent records can't be edited or deleted", () => {
    for (const t of tablesFor(true).filter((x) => ["daymark_audit_log", "daymark_consent_records"].includes(x.table))) {
      expect(t.deletable).toBeFalsy();
      expect(t.edit).toBeUndefined();
    }
  });

  test("rowKey falls back to the day results' composite key", () => {
    expect(rowKey({ id: 7 })).toBe("7");
    expect(rowKey({ placement_id: "pl1", work_date: "2026-10-05" })).toBe("pl1:2026-10-05");
  });

  test("displayValue names people, reads instants in Darwin and prints the rest as text", () => {
    expect(columnLabel("photo_path")).toBe("Photo path");
    expect(displayValue("user_id", "p1", names)).toBe("Anna Lee");
    expect(displayValue("placement_id", "pl1", names)).toBe("Anna Lee");
    expect(displayValue("user_id", "unknown", names)).toBe("unknown");
    expect(displayValue("occurred_at", "2026-10-05T23:30:00+00:00", names)).toBe("Tue 6 Oct, 9:00 am");
    expect(displayValue("active", false, names)).toBe("No");
    expect(displayValue("note", null, names)).toBe("—");
    expect(displayValue("payload", { a: 1 }, names)).toBe('{\n  "a": 1\n}');
  });

  test("a datetime round-trips through Darwin wall-clock time", () => {
    expect(inputValue("datetime", "2026-10-05T23:30:00+00:00")).toBe("2026-10-06T09:00");
    expect(inputValue("time", "09:15:00")).toBe("09:15");
    const row = { occurred_at: "2026-10-05T23:30:00+00:00", summary: "Old" };
    expect(
      changedPatch(
        [
          { name: "occurred_at", label: "Time", kind: "datetime" },
          { name: "summary", label: "Summary", kind: "textarea" },
        ],
        row,
        { occurred_at: "2026-10-06T09:15", summary: "Old" },
      ),
    ).toEqual({ occurred_at: "2026-10-05T23:45:00.000Z" });
  });

  test("changedPatch sends numbers as numbers and blanks as null", () => {
    const fields = [
      { name: "quality", label: "Quality", kind: "number" as const },
      { name: "comment", label: "Comment", kind: "textarea" as const },
    ];
    expect(changedPatch(fields, { quality: 3, comment: "Good" }, { quality: "4", comment: "" })).toEqual({
      quality: 4,
      comment: null,
    });
  });

  test("fileBatches groups by bucket in chunks", () => {
    const files = [
      ...Array.from({ length: 3 }, (_, i) => ({ bucket: "daymark-photos", path: `a/${i}.jpg` })),
      { bucket: "daymark-leave-docs", path: "a/cert.pdf" },
    ];
    expect(fileBatches(files, 2)).toEqual([
      { bucket: "daymark-photos", paths: ["a/0.jpg", "a/1.jpg"] },
      { bucket: "daymark-photos", paths: ["a/2.jpg"] },
      { bucket: "daymark-leave-docs", paths: ["a/cert.pdf"] },
    ]);
  });

  test("formatBytes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(25 * 1024 * 1024)).toBe("25 MB");
  });
});
