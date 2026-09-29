import { fileBatches, type StoredFile } from "@/lib/records";
import { createClient } from "@/lib/supabase/client";

/** Removes stored files (selfies, certificates) after their rows are deleted; returns how many failed. */
export async function removeFiles(files: StoredFile[]) {
  let failed = 0;
  for (const batch of fileBatches(files)) {
    const { error } = await createClient().storage.from(batch.bucket).remove(batch.paths);
    if (error) failed += batch.paths.length;
  }
  return failed;
}

/** The `files` list a delete or clean-up RPC returns. */
export function filesOf(result: unknown): StoredFile[] {
  const files = (result as { files?: unknown } | null)?.files;
  return Array.isArray(files) ? (files as StoredFile[]) : [];
}
