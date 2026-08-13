import type { ResumeVersion } from "@/lib/db/types";
import { ResumeUploadForm } from "./resume-upload-form";
import { ResumeRowActions } from "./resume-row-actions";

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

export function ResumeSection({ versions }: { versions: ResumeVersion[] }) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold">Resume</h2>
        <p className="text-xs text-muted-foreground">
          Stored for fit-scoring and bullet-angle suggestions.
        </p>
      </div>

      <ResumeUploadForm />

      {versions.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No resume uploaded yet. Upload a PDF above.
        </p>
      ) : (
        <ul className="space-y-2">
          {versions.map((v) => {
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
                <ResumeRowActions
                  versionId={v.id}
                  isMain={v.is_main === true}
                  isOnlyResume={isOnlyResume}
                />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
