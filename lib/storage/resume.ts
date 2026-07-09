import type { SupabaseClient } from "@supabase/supabase-js";

export const RESUME_BUCKET = "resumes";

export function resumeStoragePath(userId: string, versionId: string): string {
  return `${userId}/${versionId}.pdf`;
}

export async function uploadResumeToStorage(
  supabase: SupabaseClient,
  path: string,
  bytes: Buffer,
  contentType = "application/pdf"
): Promise<void> {
  const { error } = await supabase.storage
    .from(RESUME_BUCKET)
    .upload(path, bytes, { contentType, upsert: false });
  if (error) {
    throw new Error(`Could not upload resume: ${error.message}`);
  }
}

export async function deleteResumeFromStorage(
  supabase: SupabaseClient,
  path: string
): Promise<void> {
  const { error } = await supabase.storage.from(RESUME_BUCKET).remove([path]);
  if (error) {
    throw new Error(`Could not delete resume: ${error.message}`);
  }
}
