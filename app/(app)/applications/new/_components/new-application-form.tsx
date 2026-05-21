"use client";

import { useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { saveNewApplication } from "../actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="min-h-11 px-6">
      {pending ? "Extracting…" : "Add"}
    </Button>
  );
}

export function NewApplicationForm({ error }: { error?: string }) {
  const urlRef = useRef<HTMLInputElement>(null);

  // Auto-focus URL + auto-paste from clipboard on mount (mobile-friendly)
  useEffect(() => {
    const el = urlRef.current;
    if (!el) return;
    el.focus();
    // Best-effort clipboard read — fails silently if permission denied
    if (navigator.clipboard && el.value === "") {
      navigator.clipboard
        .readText()
        .then((text) => {
          const trimmed = text.trim();
          if (
            trimmed &&
            el.value === "" &&
            /^https?:\/\//.test(trimmed) &&
            trimmed.length < 1000
          ) {
            el.value = trimmed;
          }
        })
        .catch(() => {
          // user denied clipboard, or unavailable — no-op
        });
    }
  }, []);

  return (
    <form action={saveNewApplication} className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="url" className="text-sm">URL</Label>
        <Input
          ref={urlRef}
          id="url"
          name="url"
          type="url"
          inputMode="url"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="https://job-boards.greenhouse.io/anthropic/jobs/…"
          className="min-h-11 text-base"
        />
        <p className="text-xs text-muted-foreground">
          We&apos;ll try to extract company, role, location, deadline, comp,
          eligibility, and work model.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="jd_body" className="text-sm">
          Job description body{" "}
          <span className="text-xs font-normal text-muted-foreground">
            (recommended — most boards bot-wall scraping)
          </span>
        </Label>
        <Textarea
          id="jd_body"
          name="jd_body"
          rows={10}
          placeholder="Paste the JD text here. Pasting the body gives the auto-extraction much more to work with than just the URL."
          className="text-base"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="notes" className="text-sm">
          Your notes <span className="text-xs font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Textarea
          id="notes"
          name="notes"
          rows={3}
          placeholder="Why I'm interested, referral source, anything else."
          className="text-base"
        />
      </div>

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <div className="sticky bottom-0 -mx-4 flex items-center justify-end gap-2 border-t border-border bg-background/95 px-4 py-3 backdrop-blur md:relative md:mx-0 md:bg-transparent md:pt-6 md:backdrop-blur-none">
        <Link
          href="/pipeline"
          className={cn(buttonVariants({ variant: "outline" }), "min-h-11 px-4")}
        >
          Cancel
        </Link>
        <SubmitButton />
      </div>
    </form>
  );
}
