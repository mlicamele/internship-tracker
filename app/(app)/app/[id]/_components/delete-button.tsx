"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { deleteApplicationAction } from "../actions";

export function DeleteApplicationButton({
  applicationId,
  companyName,
}: {
  applicationId: string;
  companyName: string;
}) {
  const [pending, startTransition] = useTransition();

  function handleDelete() {
    const ok = confirm(
      `Delete this application for ${companyName}? This permanently removes it (interviews, notes, status history). Can't be undone.`
    );
    if (!ok) return;
    startTransition(async () => {
      await deleteApplicationAction(applicationId);
    });
  }

  return (
    <Button
      variant="destructive"
      size="sm"
      onClick={handleDelete}
      disabled={pending}
    >
      {pending ? "Deleting…" : "Delete application"}
    </Button>
  );
}
