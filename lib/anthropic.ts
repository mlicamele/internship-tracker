import Anthropic from "@anthropic-ai/sdk";

/**
 * Centralized Anthropic model constants. Update here when Anthropic ships new
 * generations — every classifier / generator call references these by name.
 *
 * Verified May 2026:
 *   Haiku 4.5 → claude-haiku-4-5-20251001
 *   Sonnet 4.6 → claude-sonnet-4-6
 */
export const HAIKU_MODEL = "claude-haiku-4-5-20251001";
export const SONNET_MODEL = "claude-sonnet-4-6";

let _client: Anthropic | null = null;

/**
 * Server-only Anthropic client. Lazily constructed so importing this module
 * in environments without ANTHROPIC_API_KEY (e.g. CI lint) doesn't throw.
 */
export function anthropic(): Anthropic {
  if (!_client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        "ANTHROPIC_API_KEY is not set. Add it to .env.local (see .env.example)."
      );
    }
    _client = new Anthropic({ apiKey });
  }
  return _client;
}
