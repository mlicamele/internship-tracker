"use client";

import { useEffect, useState, useTransition } from "react";
import type { ApplicationRow } from "@/lib/db/applications";
import { EditableMetadataRow } from "@/app/(app)/app/[id]/_components/editable-metadata-row";
import { InlineEdit } from "@/app/(app)/app/[id]/_components/inline-edit";
import {
  updateCompanyFieldAction,
  updateCompanyNameAction,
  updateNotesAction,
  saveCompanyNotesAction,
  getCompanyNotesAction,
} from "@/app/(app)/app/[id]/actions";

const INPUT_CLS =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
const TEXTAREA_CLS =
  "flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export function ExpandedRow({ application }: { application: ApplicationRow }) {
  const appId = application.id;
  const company = application.role.company;

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className="space-y-6 bg-muted/20 px-4 py-5"
    >
      <section className="space-y-3">
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Role
        </h3>
        <EditableMetadataRow application={application} />
      </section>

      <section className="space-y-3">
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Company
        </h3>
        <div className="grid grid-cols-1 gap-x-4 gap-y-4 rounded-md border border-border bg-card/40 p-4 sm:grid-cols-2 lg:grid-cols-3">
          <CompanyField label="Name">
            <InlineEdit<string>
              value={company.name}
              display={(v) => <span className="text-sm font-medium">{v}</span>}
              edit={({ draft, setDraft, inputRef }) => (
                <input
                  ref={inputRef as React.MutableRefObject<HTMLInputElement>}
                  type="text"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  className={INPUT_CLS}
                />
              )}
              onSave={(v) => updateCompanyNameAction(appId, v)}
            />
          </CompanyField>
          <CompanyField label="Industry tags">
            <InlineEdit<string>
              value={company.industry_tags.join(", ")}
              display={(v) =>
                v ? (
                  <span className="text-sm">{v}</span>
                ) : (
                  <span className="text-sm text-muted-foreground">—</span>
                )
              }
              edit={({ draft, setDraft, inputRef }) => (
                <input
                  ref={inputRef as React.MutableRefObject<HTMLInputElement>}
                  type="text"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  className={INPUT_CLS}
                  placeholder="SWE, Quant, ML/AI"
                />
              )}
              onSave={(v) =>
                updateCompanyFieldAction(appId, "industry_tags", v)
              }
            />
          </CompanyField>
          <CompanyField label="HQ city">
            <InlineEdit<string>
              value={company.hq_city ?? ""}
              display={(v) =>
                v ? (
                  <span className="text-sm">{v}</span>
                ) : (
                  <span className="text-sm text-muted-foreground">—</span>
                )
              }
              edit={({ draft, setDraft, inputRef }) => (
                <input
                  ref={inputRef as React.MutableRefObject<HTMLInputElement>}
                  type="text"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  className={INPUT_CLS}
                  placeholder="San Francisco, CA"
                />
              )}
              onSave={(v) => updateCompanyFieldAction(appId, "hq_city", v)}
            />
          </CompanyField>
        </div>
        <CompanyNotesEditor companyId={company.id} />
      </section>

      <section className="space-y-3">
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          This application
        </h3>
        <ApplicationNotesEditor
          applicationId={appId}
          initialValue={application.notes}
        />
      </section>
    </div>
  );
}

function CompanyField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-0.5">
      <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      {children}
    </div>
  );
}

function CompanyNotesEditor({ companyId }: { companyId: string }) {
  const [value, setValue] = useState<string | null>(null);
  const [saving, setSaving] = useTransition();

  useEffect(() => {
    let cancelled = false;
    getCompanyNotesAction(companyId).then((notes) => {
      if (!cancelled) setValue(notes);
    });
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  if (value === null) {
    return (
      <p className="text-xs text-muted-foreground">Loading company notes…</p>
    );
  }

  return (
    <div className="space-y-1">
      <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        Company notes (all roles)
      </label>
      <textarea
        rows={3}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          setSaving(async () => {
            await saveCompanyNotesAction(companyId, value);
          });
        }}
        className={TEXTAREA_CLS}
        placeholder="Notes that apply to every role at this company…"
      />
      {saving && (
        <p className="text-[10px] text-muted-foreground">Saving…</p>
      )}
    </div>
  );
}

function ApplicationNotesEditor({
  applicationId,
  initialValue,
}: {
  applicationId: string;
  initialValue: string;
}) {
  const [value, setValue] = useState(initialValue);
  const [saving, setSaving] = useTransition();

  return (
    <div className="space-y-1">
      <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        Notes for this posting
      </label>
      <textarea
        rows={4}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          setSaving(async () => {
            await updateNotesAction(applicationId, value);
          });
        }}
        className={TEXTAREA_CLS}
        placeholder="Status notes, contacts, follow-ups…"
      />
      {saving && (
        <p className="text-[10px] text-muted-foreground">Saving…</p>
      )}
    </div>
  );
}
