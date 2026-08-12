"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  listResumeVersions,
  createResumeVersion,
  deleteResumeVersion,
  setMainResumeVersion,
} from "@/lib/db/resume-versions";
import {
  resumeStoragePath,
  uploadResumeToStorage,
  deleteResumeFromStorage,
} from "@/lib/storage/resume";
import { parseResumePdf } from "@/lib/resume/parse";
import { rescoreResumeFitForUserMaster } from "@/lib/db/resume-fit";

const MAX_BYTES = 10 * 1024 * 1024;

function fail(msg: string): never {
  redirect(`/settings?resume_error=${encodeURIComponent(msg)}`);
}

export async function uploadResumeAction(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const file = formData.get("file");
  const labelRaw = formData.get("label");

  if (!(file instanceof File) || file.size === 0) fail("Pick a PDF to upload");

  const isPdf =
    file.type === "application/pdf" ||
    file.name.toLowerCase().endsWith(".pdf");
  if (!isPdf) fail("Only PDFs are supported");

  if (file.size > MAX_BYTES) fail("Resume must be under 10MB");

  const labelInput = typeof labelRaw === "string" ? labelRaw.trim() : "";
  const derived = file.name.replace(/\.pdf$/i, "");
  const label = (labelInput || derived).slice(0, 80);

  const bytes = Buffer.from(await file.arrayBuffer());

  let text: string;
  try {
    const parsed = await parseResumePdf(bytes);
    text = parsed.text;
  } catch (err) {
    fail(err instanceof Error ? err.message : "Could not parse PDF");
  }

  const versionId = crypto.randomUUID();
  const path = resumeStoragePath(user.id, versionId);

  try {
    await uploadResumeToStorage(supabase, path, bytes);
  } catch {
    fail("Upload failed");
  }

  const existing = await listResumeVersions(supabase, user.id);
  const isFirst = existing.length === 0;

  try {
    await createResumeVersion(supabase, {
      id: versionId,
      user_id: user.id,
      label,
      storage_path: path,
      file_size_bytes: file.size,
      mime_type: "application/pdf",
      extracted_text: text,
      is_main: isFirst,
    });
  } catch (err) {
    try {
      await deleteResumeFromStorage(supabase, path);
    } catch {}
    fail(err instanceof Error ? err.message : "Could not save resume");
  }

  // First-ever upload auto-promotes to main. Any application without an
  // explicit resume_version_id now resolves to this new resume, so score.
  // Non-throwing — settings save should still succeed on Groq errors.
  if (isFirst) {
    try {
      await rescoreResumeFitForUserMaster(supabase, user.id);
    } catch (err) {
      console.error("resume-fit rescore after first upload failed:", err);
    }
  }

  revalidatePath("/settings");
  redirect("/settings?resume_saved=1");
}

export async function deleteResumeAction(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const id = formData.get("id");
  if (typeof id !== "string" || !id) fail("Missing id");

  const versions = await listResumeVersions(supabase, user.id);
  const target = versions.find((r) => r.id === id);
  if (!target) fail("Resume not found");

  if (target.is_main === true && versions.length > 1) {
    fail("Set another resume as main before deleting this one");
  }

  await deleteResumeVersion(supabase, user.id, id);

  try {
    await deleteResumeFromStorage(supabase, target.storage_path);
  } catch (err) {
    console.error("deleteResumeFromStorage failed:", err);
  }

  revalidatePath("/settings");
  redirect("/settings?resume_deleted=1");
}

export async function setMainResumeAction(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const id = formData.get("id");
  if (typeof id !== "string" || !id) fail("Missing id");

  await setMainResumeVersion(supabase, user.id, id);

  // Apps without an explicit attach now resolve to the new main. Rescore.
  try {
    await rescoreResumeFitForUserMaster(supabase, user.id);
  } catch (err) {
    console.error("resume-fit rescore after main swap failed:", err);
  }

  revalidatePath("/settings");
  revalidatePath("/inbox");
  redirect("/settings?resume_saved=1");
}
