import type { ResumeVersion } from "@/lib/db/types";
import { Button } from "@/components/ui/button";
import {
  deleteResumeAction,
  setMainResumeAction,
} from "../resume-actions";
import { ResumeUploadForm } from "./resume-upload-form";

function formatBytes(n: number | null): string {
  if (n === null) return "—";
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function ResumeSection({
  versions,
  deleted,
}: {
  versions: ResumeVersion[];
  /**
   * Delete banner still uses URL-param signalling because deleteResumeAction
   * still redirects. Not migrated to useActionState in this pass — matches
   * the smaller scope of the upload UX task.
   */
  deleted?: string;
}) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold">Resume</h2>
        <p className="text-xs text-muted-foreground">
          Stored for fit-scoring and bullet-angle suggestions.
        </p>
      </div>

      {deleted === "1" && (
        <div className="rounded-md border border-border bg-card p-3 text-sm text-muted-foreground">
          Resume deleted.
        </div>
      )}

      <ResumeUploadForm />

      {versions.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No resume uploaded yet. Upload a PDF above.
        </p>
      ) : (
        <ul className="space-y-2">
          {versions.map((v) => {
            // Block deleting the last-remaining resume — scoring relies on
            // having a main resume, so we require an upload before delete
            // when there's only one row. Server-side action re-checks the
            // invariant so the button isn't a load-bearing UI guard.
            const isOnlyResume = versions.length === 1;
            return (
              <li
                key={v.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border bg-card p-3"
              >
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{v.label}</span>
                    {v.is_main && (
                      <span className="rounded-full border border-primary bg-primary px-2 py-0.5 text-[0.65rem] font-medium text-primary-foreground">
                        Main
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {formatBytes(v.file_size_bytes)} · {formatDate(v.uploaded_at)}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {!v.is_main && (
                    <form action={setMainResumeAction}>
                      <input type="hidden" name="id" value={v.id} />
                      <Button type="submit" size="sm" variant="outline">
                        Set as main
                      </Button>
                    </form>
                  )}
                  <form action={deleteResumeAction}>
                    <input type="hidden" name="id" value={v.id} />
                    <Button
                      type="submit"
                      size="sm"
                      variant="ghost"
                      disabled={isOnlyResume}
                      title={
                        isOnlyResume
                          ? "Upload a replacement before deleting your only resume"
                          : undefined
                      }
                    >
                      Delete
                    </Button>
                  </form>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
