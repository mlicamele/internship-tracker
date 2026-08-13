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

/** Result of the upload action — consumed by `useActionState` in the client form. */
export type UploadResumeResult =
  | { ok: true; label: string }
  | { ok: false; error: string };

/**
 * Upload + parse + persist a resume. Signature matches `useActionState`'s
 * `(prevState, formData) => Promise<newState>` shape so the client form can
 * show a spinner during extraction and a ✓ confirmation on success without
 * a full-page reload. `revalidatePath("/settings")` still fires so the
 * server-rendered resume list updates.
 *
 * Errors are returned as `{ok: false, error}` instead of throwing/redirecting
 * so the form can surface them inline. Only the unauthenticated case still
 * redirects (to /login) — that's a navigation, not a form-level error.
 */
export async function uploadResumeAction(
  _prev: UploadResumeResult,
  formData: FormData
): Promise<UploadResumeResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const file = formData.get("file");
  const labelRaw = formData.get("label");

  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Pick a PDF to upload" };
  }

  const isPdf =
    file.type === "application/pdf" ||
    file.name.toLowerCase().endsWith(".pdf");
  if (!isPdf) return { ok: false, error: "Only PDFs are supported" };

  if (file.size > MAX_BYTES) {
    return { ok: false, error: "Resume must be under 10MB" };
  }

  const labelInput = typeof labelRaw === "string" ? labelRaw.trim() : "";
  const derived = file.name.replace(/\.pdf$/i, "");
  const label = (labelInput || derived).slice(0, 80);

  const bytes = Buffer.from(await file.arrayBuffer());

  let text: string;
  try {
    const parsed = await parseResumePdf(bytes);
    text = parsed.text;
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not parse PDF",
    };
  }

  const versionId = crypto.randomUUID();
  const path = resumeStoragePath(user.id, versionId);

  try {
    await uploadResumeToStorage(supabase, path, bytes);
  } catch {
    return { ok: false, error: "Upload failed" };
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
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not save resume",
    };
  }

  // First-ever upload auto-promotes to main. Any application without an
  // explicit resume_version_id now resolves to this new resume, so score.
  // Non-throwing — the upload itself already succeeded on Groq errors.
  if (isFirst) {
    try {
      await rescoreResumeFitForUserMaster(supabase, user.id);
    } catch (err) {
      console.error("resume-fit rescore after first upload failed:", err);
    }
  }

  revalidatePath("/settings");
  return { ok: true, label };
}

/** Result shape shared by delete + set-main actions (useActionState). */
export type RowActionResult = { ok: true } | { ok: false; error: string };

export async function deleteResumeAction(
  _prev: RowActionResult,
  formData: FormData
): Promise<RowActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const id = formData.get("id");
  if (typeof id !== "string" || !id) return { ok: false, error: "Missing id" };

  const versions = await listResumeVersions(supabase, user.id);
  const target = versions.find((r) => r.id === id);
  if (!target) return { ok: false, error: "Resume not found" };

  // Invariant: user must always have at least one main resume — scoring
  // relies on it. Only block deletion when this is the LAST resume; when
  // deleting the current main and others exist, auto-promote the most
  // recently uploaded remaining resume so the user never has to think
  // about it.
  if (versions.length === 1) {
    return {
      ok: false,
      error: "Upload a replacement before deleting your only resume",
    };
  }

  if (target.is_main === true) {
    // listResumeVersions orders by uploaded_at DESC → the first non-target
    // row is the newest survivor. Promote it BEFORE deleting the current
    // main so we never have zero rows with is_main=TRUE.
    const successor = versions.find((r) => r.id !== id);
    if (!successor) {
      return {
        ok: false,
        error: "Could not find another resume to promote as main",
      };
    }
    try {
      await setMainResumeVersion(supabase, user.id, successor.id);
    } catch (err) {
      console.error("auto-promote before delete-main failed:", err);
      return {
        ok: false,
        error: "Could not promote a replacement main; delete aborted",
      };
    }
  }

  await deleteResumeVersion(supabase, user.id, id);

  try {
    await deleteResumeFromStorage(supabase, target.storage_path);
  } catch (err) {
    console.error("deleteResumeFromStorage failed:", err);
  }

  revalidatePath("/settings");
  return { ok: true };
}

export async function setMainResumeAction(
  _prev: RowActionResult,
  formData: FormData
): Promise<RowActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const id = formData.get("id");
  if (typeof id !== "string" || !id) return { ok: false, error: "Missing id" };

  try {
    await setMainResumeVersion(supabase, user.id, id);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not set main resume",
    };
  }

  // Apps without an explicit attach now resolve to the new main. Rescore.
  try {
    await rescoreResumeFitForUserMaster(supabase, user.id);
  } catch (err) {
    console.error("resume-fit rescore after main swap failed:", err);
  }

  revalidatePath("/settings");
  revalidatePath("/inbox");
  return { ok: true };
}
