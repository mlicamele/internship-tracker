"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Textarea } from "@/components/ui/textarea";
import { saveCompanyNotesAction } from "../actions";

const DEBOUNCE_MS = 500;

export function CompanyNotesSection({
  companyId,
  companyName,
  initialNotes,
}: {
  companyId: string;
  companyName: string;
  initialNotes: string;
}) {
  const [notes, setNotes] = useState(initialNotes);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [pending, startTransition] = useTransition();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (notes === initialNotes && savedAt === null) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      startTransition(async () => {
        await saveCompanyNotesAction(companyId, notes);
        setSavedAt(new Date());
      });
    }, DEBOUNCE_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, companyId]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Company notes · {companyName}
        </h2>
        <span className="text-xs text-muted-foreground" aria-live="polite">
          {pending ? "Saving…" : savedAt ? "Saved" : ""}
        </span>
      </div>
      <Textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={4}
        placeholder="Notes about this company that survive across applications. Interview process, comp ranges, eng blog, anyone you know there."
      />
    </div>
  );
}
