import { createClient } from "@/lib/supabase/client";

// Medical certificates on leave requests (§9.2, review §2.3, rule 20). The bucket, its path rule,
// 5 MB limit and types are enforced by Storage and attach_leave_certificate; this is the friendly
// first check and the three calls in the order the database requires.
export const CERT_BUCKET = "daymark-leave-docs";
export const CERT_MAX_BYTES = 5 * 1024 * 1024;
export const CERT_ACCEPT = ".pdf,image/jpeg,image/png";
export const CERT_SIGNED_URL_SECONDS = 60;

const EXTENSION: Record<string, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png" };

/** Null when the file can be uploaded, otherwise the message to show. */
export function certificateFileError(file: { type: string; size: number } | null | undefined) {
  if (!file) return "Choose a file first.";
  if (!EXTENSION[file.type]) return "Use a PDF, JPG or PNG file.";
  if (file.size === 0) return "That file is empty. Choose another.";
  if (file.size > CERT_MAX_BYTES) return "That file is over 5 MB. Choose a smaller file or take a photo of the page.";
  return null;
}

/** `<uid>/<uuid>.<ext>`, the only shape the bucket policy accepts. */
export function certificatePath(uid: string, type: string, id: string = crypto.randomUUID()) {
  return `${uid}/${id}.${EXTENSION[type]}`;
}

/** Consent first, then the upload, then the link to the pending leave request. */
export async function addCertificate(requestId: string, uid: string, file: File) {
  const problem = certificateFileError(file);
  if (problem) throw new Error(problem);
  const supabase = createClient();
  const consent = await supabase.rpc("record_consent", {
    purpose: "medical_certificate",
    decision: "granted",
    related_id: requestId,
  });
  if (consent.error) throw consent.error;
  const path = certificatePath(uid, file.type);
  // ponytail: a file whose attach call fails stays in the bucket (no delete through the API);
  // the retention purge only sees attached files. Upgrade: an orphan sweep in retention-purge.
  const upload = await supabase.storage.from(CERT_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
  if (upload.error) throw upload.error;
  const attach = await supabase.rpc("attach_leave_certificate", { request_id: requestId, path });
  if (attach.error) throw attach.error;
}

export async function certificateUrl(path: string) {
  const { data, error } = await createClient().storage.from(CERT_BUCKET).createSignedUrl(path, CERT_SIGNED_URL_SECONDS);
  if (error) throw error;
  return data.signedUrl;
}
