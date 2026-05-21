// Shared types for parsers (split out to avoid cycle: parsers import this,
// url.ts re-exports for external callers).

export interface ParserResult {
  company: string | null;
  title: string | null;
  location: string | null;
  jd_body: string;
  extras: Record<string, string | null>;
}
