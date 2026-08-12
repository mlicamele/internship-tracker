"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/inbox", label: "Inbox" },
  { href: "/pipeline", label: "Pipeline" },
  { href: "/archive", label: "Archive" },
  { href: "/settings", label: "Settings" },
] as const;

/**
 * Top nav with an active-route indicator. Uses `usePathname()` so it
 * highlights the current section even on dynamic child routes
 * (e.g. `/app/[id]` counts as "no section" — the detail page isn't
 * one of the top-level tabs).
 *
 * Active-detection uses startsWith so `/pipeline` matches `/pipeline`
 * and any future sub-routes; `/inbox` catches the inbox root.
 */
export function AppNav() {
  const pathname = usePathname();
  return (
    <nav className="flex items-center gap-1 text-sm">
      {NAV_ITEMS.map(({ href, label }) => {
        const isActive =
          pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1.5 transition-colors",
              isActive
                ? "bg-accent font-medium text-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            )}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
