/**
 * Adversarial harness for lib/capture/resolve.ts.
 *
 * No DB writes — this only exercises the URL/text → { targetUrl, extraContext }
 * resolution logic. Jina Reader is hit live (network dependency).
 *
 * Usage:
 *   npx tsx scripts/test-capture.ts
 *
 * Output → scripts/test-capture-output.txt (gitignored via scripts/*.txt).
 */

import { config as dotenvConfig } from "dotenv";
import { writeFileSync, createWriteStream } from "fs";
import { resolve } from "path";

const OUTPUT_FILE = resolve(process.cwd(), "scripts/test-capture-output.txt");
writeFileSync(OUTPUT_FILE, "");
const fileStream = createWriteStream(OUTPUT_FILE, { flags: "a" });
const ANSI = /\x1b\[[0-9;]*m/g;
function tee(stream: NodeJS.WriteStream) {
  const orig = stream.write.bind(stream);
  stream.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
    const text =
      typeof chunk === "string"
        ? chunk
        : chunk instanceof Uint8Array
        ? Buffer.from(chunk).toString()
        : "";
    if (text) fileStream.write(text.replace(ANSI, ""));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return orig(chunk as any, ...(rest as any));
  }) as typeof stream.write;
}
tee(process.stdout);
tee(process.stderr);

dotenvConfig({ path: resolve(process.cwd(), ".env.local") });

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { resolveCapture } = require("../lib/capture/resolve") as typeof import("../lib/capture/resolve");

interface Scenario {
  name: string;
  input: { url: string | null; text: string | null };
  expect: {
    targetUrl?: "greenhouse" | "lever" | "ashby" | "workday" | "same-as-input" | "null" | "any-social";
    extraContextNonEmpty?: boolean;
    noteContains?: string;
  };
}

const scenarios: Scenario[] = [
  {
    name: "direct greenhouse URL",
    input: {
      url: "https://job-boards.greenhouse.io/anthropic/jobs/4456891",
      text: null,
    },
    expect: { targetUrl: "greenhouse", noteContains: "job-board URL" },
  },
  {
    name: "text with embedded greenhouse URL (no url field)",
    input: {
      url: null,
      text: "Just saw this pop up: https://job-boards.greenhouse.io/anthropic/jobs/4456891 — apply asap",
    },
    expect: { targetUrl: "greenhouse", noteContains: "job-board URL" },
  },
  {
    name: "url is social + text has embedded lever URL",
    input: {
      url: "https://vm.tiktok.com/ZMhABC123/",
      text: "https://jobs.lever.co/discord/some-role",
    },
    expect: { targetUrl: "lever", noteContains: "job-board URL" },
  },
  {
    name: "URL with trailing punctuation",
    input: {
      url: null,
      text: "Check it out here: https://job-boards.greenhouse.io/openai/jobs/12345, before Friday.",
    },
    expect: { targetUrl: "greenhouse" },
  },
  {
    name: "text only, no URL",
    input: {
      url: null,
      text: "Meta SWE Summer 2027 dropped today",
    },
    expect: { targetUrl: "null", extraContextNonEmpty: true, noteContains: "text-only" },
  },
  {
    name: "empty input",
    input: { url: null, text: null },
    expect: { targetUrl: "null", noteContains: "empty" },
  },
  {
    name: "malformed URL",
    input: { url: "not-a-url", text: null },
    expect: { targetUrl: "null" },
  },
  {
    name: "TikTok short URL (LIVE Jina)",
    input: { url: "https://www.tiktok.com/@zero2sudo", text: null },
    expect: {
      // We don't hard-assert here — TikTok's caption content is variable and
      // Jina may or may not surface an embedded job URL. This is a smoke test.
    },
  },
];

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const GRAY = "\x1b[90m";
const RESET = "\x1b[0m";

function check(scenario: Scenario, actual: { targetUrl: string | null; extraContext: string | null; note: string }): { passed: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const { expect } = scenario;
  if (expect.targetUrl === "null" && actual.targetUrl !== null) {
    reasons.push(`expected null targetUrl, got ${actual.targetUrl}`);
  }
  if (expect.targetUrl && expect.targetUrl !== "null" && expect.targetUrl !== "same-as-input" && expect.targetUrl !== "any-social") {
    if (!actual.targetUrl?.includes(expect.targetUrl)) {
      reasons.push(`expected ${expect.targetUrl} URL, got ${actual.targetUrl}`);
    }
  }
  if (expect.extraContextNonEmpty && !actual.extraContext) {
    reasons.push(`expected extraContext, got empty`);
  }
  if (expect.noteContains && !actual.note.toLowerCase().includes(expect.noteContains.toLowerCase())) {
    reasons.push(`expected note to contain "${expect.noteContains}", got "${actual.note}"`);
  }
  return { passed: reasons.length === 0, reasons };
}

async function main() {
  console.log(`\n${GRAY}Running ${scenarios.length} capture resolve scenarios...${RESET}\n`);

  let passed = 0;
  let failed = 0;

  for (const scenario of scenarios) {
    process.stdout.write(`${GRAY}[${scenario.name}]${RESET} `);
    try {
      const result = await resolveCapture(scenario.input);
      const { passed: ok, reasons } = check(scenario, result);
      if (ok) {
        console.log(`${GREEN}PASS${RESET}`);
        passed++;
      } else {
        console.log(`${RED}FAIL${RESET}`);
        for (const r of reasons) console.log(`  ${RED}× ${r}${RESET}`);
        failed++;
      }
      console.log(`  ${GRAY}targetUrl:${RESET} ${result.targetUrl ?? "(null)"}`);
      console.log(`  ${GRAY}note:${RESET} ${result.note}`);
      if (result.extraContext) {
        const preview = result.extraContext.replace(/\s+/g, " ").slice(0, 120);
        console.log(`  ${GRAY}extraContext:${RESET} ${preview}${result.extraContext.length > 120 ? "…" : ""}`);
      }
      console.log("");
    } catch (err) {
      console.log(`${RED}THROW${RESET}`);
      console.log(`  ${RED}${err instanceof Error ? err.message : String(err)}${RESET}\n`);
      failed++;
    }
  }

  console.log(
    `\n${passed === scenarios.length ? GREEN : YELLOW}${passed}/${scenarios.length} passed${RESET}${failed ? ` — ${RED}${failed} failed${RESET}` : ""}\n`
  );
  process.exit(failed ? 1 : 0);
}

main();
