"use client";

import { useTransition } from "react";
import type { ApplicationStatus } from "@/lib/db/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StatusPill, STATUS_OPTIONS } from "./cell-formatters";
import { transitionStatusAction } from "../actions";

export function StatusCell({
  applicationId,
  status,
}: {
  applicationId: string;
  status: ApplicationStatus;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        onClick={(e) => e.stopPropagation()}
        disabled={pending}
        aria-label={`Status: ${status}`}
        className="cursor-pointer rounded-sm focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <StatusPill status={status} />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        onClick={(e) => e.stopPropagation()}
      >
        {STATUS_OPTIONS.map(({ value, label }) => (
          <DropdownMenuItem
            key={value}
            disabled={value === status}
            onClick={(e) => {
              e.stopPropagation();
              if (value === status) return;
              startTransition(async () => {
                await transitionStatusAction(applicationId, value);
              });
            }}
          >
            <StatusPill status={value} />
            <span className="ml-2 text-sm">{label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
