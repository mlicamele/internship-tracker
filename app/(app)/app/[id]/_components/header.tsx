"use client";

import Link from "next/link";
import type { ApplicationRow } from "@/lib/db/applications";
import { StatusCell } from "@/app/(app)/pipeline/_components/status-cell";
import { InlineEdit } from "./inline-edit";
import {
  updateCompanyNameAction,
  updateRoleFieldAction,
} from "../actions";

const INPUT_BASE =
  "w-full rounded-md border border-input bg-transparent px-2 py-1 shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export function DetailHeader({ application }: { application: ApplicationRow }) {
  const appId = application.id;

  return (
    <header className="space-y-2">
      <Link
        href="/pipeline"
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        ← Pipeline
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1 flex-1 min-w-0">
          <InlineEdit<string>
            value={application.role.company.name}
            display={(v) => (
              <h1 className="text-2xl font-semibold tracking-tight">{v}</h1>
            )}
            edit={({ draft, setDraft, inputRef }) => (
              <input
                ref={inputRef as React.MutableRefObject<HTMLInputElement>}
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className={`${INPUT_BASE} text-2xl font-semibold tracking-tight`}
              />
            )}
            onSave={(v) => updateCompanyNameAction(appId, v)}
          />
          <InlineEdit<string>
            value={application.role.title}
            display={(v) => (
              <p className="text-sm text-muted-foreground">{v}</p>
            )}
            edit={({ draft, setDraft, inputRef }) => (
              <input
                ref={inputRef as React.MutableRefObject<HTMLInputElement>}
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className={`${INPUT_BASE} text-sm`}
              />
            )}
            onSave={(v) => updateRoleFieldAction(appId, "title", v)}
          />
        </div>
        <StatusCell
          applicationId={application.id}
          status={application.status}
        />
      </div>
    </header>
  );
}
