import type { StatusEvent } from "@/lib/db/types";
import { formatDate } from "@/app/(app)/pipeline/_components/cell-formatters";

export function StatusTimeline({ events }: { events: StatusEvent[] }) {
  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        Status timeline
      </h2>
      {events.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">No events yet.</p>
      ) : (
        <ol className="space-y-2 text-sm">
          {events.map((event) => (
            <li key={event.id} className="flex items-start gap-3">
              <span className="mt-1 size-1.5 flex-shrink-0 rounded-full bg-muted-foreground/60" />
              <div className="flex-1 space-y-0.5">
                <p className="text-xs text-muted-foreground">
                  {formatDate(event.occurred_at)}
                </p>
                <p>
                  {event.from_status ? (
                    <>
                      <span className="text-muted-foreground capitalize">
                        {event.from_status.replace(/_/g, " ")}
                      </span>
                      <span className="mx-1 text-muted-foreground">→</span>
                    </>
                  ) : null}
                  <span className="capitalize">
                    {event.to_status.replace(/_/g, " ")}
                  </span>
                </p>
                {event.note && (
                  <p className="text-xs text-muted-foreground italic">
                    {event.note}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
