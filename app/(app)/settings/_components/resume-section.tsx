import type { ResumeVersion } from "@/lib/db/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  uploadResumeAction,
  deleteResumeAction,
  setMasterResumeAction,
} from "../resume-actions";

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
  error,
  saved,
  deleted,
}: {
  versions: ResumeVersion[];
  error?: string;
  saved?: string;
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

      {saved === "1" && (
        <div className="rounded-md border border-border bg-card p-3 text-sm text-muted-foreground">
          Resume saved.
        </div>
      )}
      {deleted === "1" && (
        <div className="rounded-md border border-border bg-card p-3 text-sm text-muted-foreground">
          Resume deleted.
        </div>
      )}
      {error && (
        <p className="text-sm text-destructive" role="alert">
          Resume: {error}
        </p>
      )}

      <form
        action={uploadResumeAction}
        encType="multipart/form-data"
        className="space-y-2"
      >
        <Input type="file" name="file" accept="application/pdf" required />
        <Input
          type="text"
          name="label"
          placeholder="Label (optional — defaults to filename)"
          maxLength={80}
        />
        <Button type="submit">Upload</Button>
      </form>

      {versions.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No resume uploaded yet. Upload a PDF above.
        </p>
      ) : (
        <ul className="space-y-2">
          {versions.map((v) => (
            <li
              key={v.id}
              className="flex items-center justify-between gap-3 rounded-md border border-border bg-card p-3"
            >
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{v.label}</span>
                  {v.is_master && (
                    <span className="rounded-full border border-primary bg-primary px-2 py-0.5 text-[0.65rem] font-medium text-primary-foreground">
                      Master
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  {formatBytes(v.file_size_bytes)} · {formatDate(v.uploaded_at)}
                </div>
              </div>
              <div className="flex items-center gap-1">
                {!v.is_master && (
                  <form action={setMasterResumeAction}>
                    <input type="hidden" name="id" value={v.id} />
                    <Button type="submit" size="sm" variant="outline">
                      Set as master
                    </Button>
                  </form>
                )}
                <form action={deleteResumeAction}>
                  <input type="hidden" name="id" value={v.id} />
                  <Button type="submit" size="sm" variant="ghost">
                    Delete
                  </Button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
