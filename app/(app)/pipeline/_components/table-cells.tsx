"use client";

import {
  type CSSProperties,
  type InputHTMLAttributes,
  type ReactNode,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type SaveResult = { ok: true } | { ok: false; error: string };

/**
 * Always-visible input that looks like static text by default. Cursor lives
 * inside on focus, so editing is single-click. Border + bg are transparent,
 * so the cell never visibly resizes between "viewing" and "editing".
 *
 * For type="number" and type="date" the browser supplies its own UI (spinners,
 * calendar) on focus, but the static dimensions stay the same.
 */
export function TableTextField({
  value,
  onSave,
  prefix,
  suffix,
  align = "left",
  className,
  inputClassName,
  style,
  ...inputProps
}: {
  value: string;
  onSave: (next: string) => Promise<SaveResult> | void;
  prefix?: ReactNode;
  suffix?: ReactNode;
  align?: "left" | "right";
  className?: string;
  inputClassName?: string;
  style?: CSSProperties;
} & Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "onBlur" | "onKeyDown" | "className"
>) {
  const [draft, setDraft] = useState(value);
  const [pending, startTransition] = useTransition();
  const lastCommitted = useRef(value);

  // Resync when server data changes underneath us. Conditional inside the
  // effect means the lint rule doesn't fire on every render.
  useEffect(() => {
    if (lastCommitted.current !== value) {
      setDraft(value);
      lastCommitted.current = value;
    }
  }, [value]);

  function commit() {
    if (draft === lastCommitted.current) return;
    lastCommitted.current = draft;
    startTransition(async () => {
      await onSave(draft);
    });
  }

  function cancel() {
    setDraft(lastCommitted.current);
  }

  return (
    <span
      className={cn(
        "inline-flex h-7 items-center gap-1 rounded-sm px-1.5",
        className
      )}
      onClick={(e) => e.stopPropagation()}
    >
      {prefix && <span className="text-muted-foreground">{prefix}</span>}
      <input
        {...inputProps}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          } else if (e.key === "Escape") {
            e.preventDefault();
            cancel();
            (e.target as HTMLInputElement).blur();
          }
        }}
        style={style}
        className={cn(
          "h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-0",
          align === "right" && "text-right",
          inputClassName
        )}
      />
      {suffix && <span className="text-muted-foreground">{suffix}</span>}
      {pending && <span className="text-xs text-muted-foreground">…</span>}
    </span>
  );
}

/**
 * Single-click dropdown-menu picker. Same UX shape as the pipeline
 * StatusCell: click trigger → menu opens → click option → saves.
 */
export function TableEnumField<T extends string>({
  value,
  options,
  onSave,
  renderValue,
  placeholder,
}: {
  value: T | null;
  options: { value: T; label: string; render?: ReactNode }[];
  onSave: (next: T | null) => Promise<SaveResult> | void;
  renderValue: (v: T | null) => ReactNode;
  placeholder?: ReactNode;
}) {
  const [pending, startTransition] = useTransition();

  function pick(next: T | null) {
    if (next === value) return;
    startTransition(async () => {
      await onSave(next);
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        onClick={(e) => e.stopPropagation()}
        className="inline-flex h-7 cursor-pointer items-center rounded-sm px-1.5 text-left hover:bg-muted/40 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
        disabled={pending}
      >
        {value !== null ? (
          renderValue(value)
        ) : (
          <span className="text-muted-foreground">{placeholder ?? "—"}</span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" onClick={(e) => e.stopPropagation()}>
        {placeholder !== undefined && (
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation();
              pick(null);
            }}
            disabled={value === null}
          >
            <span className="text-muted-foreground">{placeholder}</span>
          </DropdownMenuItem>
        )}
        {options.map((opt) => (
          <DropdownMenuItem
            key={opt.value}
            disabled={opt.value === value}
            onClick={(e) => {
              e.stopPropagation();
              pick(opt.value);
            }}
          >
            {opt.render ?? opt.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
