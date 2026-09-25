import { describe, expect, test, vi } from "vitest";
import { CERT_MAX_BYTES, addCertificate, certificateFileError, certificatePath } from "@/lib/certificates";

const calls: string[] = [];
const rpc = vi.fn(async (name: string) => {
  calls.push(name);
  return { error: null };
});
const upload = vi.fn(async (path: string) => {
  calls.push(`upload ${path}`);
  return { error: null };
});
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ rpc, storage: { from: () => ({ upload }) } }),
}));

const UID = "11111111-1111-4111-8111-111111111111";
const ID = "22222222-2222-4222-8222-222222222222";

describe("leave certificates", () => {
  test("accepts PDF, JPG and PNG up to 5 MB", () => {
    expect(certificateFileError({ type: "application/pdf", size: 1000 })).toBeNull();
    expect(certificateFileError({ type: "image/jpeg", size: CERT_MAX_BYTES })).toBeNull();
    expect(certificateFileError({ type: "image/png", size: 1 })).toBeNull();
  });

  test("rejects other types, empty and oversized files", () => {
    expect(certificateFileError(null)).toBe("Choose a file first.");
    expect(certificateFileError({ type: "image/heic", size: 1000 })).toMatch(/PDF, JPG or PNG/);
    expect(certificateFileError({ type: "", size: 1000 })).toMatch(/PDF, JPG or PNG/);
    expect(certificateFileError({ type: "application/pdf", size: 0 })).toMatch(/empty/);
    expect(certificateFileError({ type: "application/pdf", size: CERT_MAX_BYTES + 1 })).toMatch(/over 5 MB/);
  });

  test("path matches the bucket rule <uid>/<uuid>.<ext>", () => {
    const rule = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(pdf|jpg|jpeg|png)$/;
    expect(certificatePath(UID, "image/jpeg", ID)).toBe(`${UID}/${ID}.jpg`);
    expect(certificatePath(UID, "application/pdf", ID)).toMatch(rule);
    expect(certificatePath(UID, "image/png")).toMatch(rule);
  });

  test("records consent, then uploads, then attaches", async () => {
    const file = new File(["%PDF-1.7"], "cert.pdf", { type: "application/pdf" });
    await addCertificate("req-1", UID, file);
    expect(calls[0]).toBe("record_consent");
    expect(rpc.mock.calls[0]).toEqual([
      "record_consent",
      { purpose: "medical_certificate", decision: "granted", related_id: "req-1" },
    ]);
    expect(calls[1]).toMatch(new RegExp(`^upload ${UID}/[0-9a-f-]{36}\\.pdf$`));
    expect(calls[2]).toBe("attach_leave_certificate");
    const path = calls[1].slice("upload ".length);
    expect(rpc.mock.calls[1]).toEqual(["attach_leave_certificate", { request_id: "req-1", path }]);
  });

  test("a bad file never reaches consent or storage", async () => {
    calls.length = 0;
    const file = new File(["x"], "cert.heic", { type: "image/heic" });
    await expect(addCertificate("req-1", UID, file)).rejects.toThrow(/PDF, JPG or PNG/);
    expect(calls).toEqual([]);
  });
});
