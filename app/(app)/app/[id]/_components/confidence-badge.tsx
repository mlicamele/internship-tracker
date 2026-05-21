"use client";

/**
 * Small inline confidence indicator. Hovering shows the per-field
 * confidence emitted by the LLM extractor. Renders nothing when there
 * is no confidence for the field (user-edited or never extracted).
 */
export function ConfidenceBadge({
  confidence,
}: {
  confidence: number | undefined;
}) {
  if (confidence === undefined || confidence === null) return null;
  const pct = Math.round(confidence * 100);
  const tone =
    confidence >= 0.8
      ? "text-emerald-500"
      : confidence >= 0.6
        ? "text-amber-500"
        : "text-rose-500";
  return (
    <span
      className={`ml-1 inline-flex h-3.5 w-3.5 cursor-help select-none items-center justify-center rounded-full border border-current text-[8px] font-semibold leading-none ${tone}`}
      title={`Auto-extraction confidence: ${pct}%`}
      aria-label={`Auto-extraction confidence: ${pct}%`}
    >
      i
    </span>
  );
}
