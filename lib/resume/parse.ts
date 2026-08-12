/**
 * Resume PDF text extraction.
 *
 * Loads `pdf-parse` lazily via dynamic import — the module and its
 * `pdfjs-dist` dependency reach for browser globals (specifically
 * `DOMMatrix`) at module init, which are undefined in Node runtimes
 * on Vercel. A top-level `import` triggers the crash on any route that
 * imports THIS file's caller chain (notably /settings → ResumeSection
 * → resume-actions → parse), even if the user never uploads a PDF.
 *
 * Dynamic-importing here defers the load until parseResumePdf() is
 * actually called (upload path only), so the /settings render succeeds.
 * See Vercel error: `ReferenceError: DOMMatrix is not defined` at
 * externalImport for pdf-parse.
 */

export async function parseResumePdf(
  bytes: Buffer
): Promise<{ text: string; pageCount: number }> {
  // Lazy — see file-level comment. Do NOT hoist to a top-level import.
  const { PDFParse } = await import("pdf-parse");

  let result;
  try {
    const parser = new PDFParse({ data: new Uint8Array(bytes) });
    result = await parser.getText();
    await parser.destroy();
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not parse PDF: ${detail}`);
  }

  const text = normalizeText(result.text ?? "");
  if (!text) {
    throw new Error("Resume PDF contained no extractable text (image-only?)");
  }

  return { text, pageCount: result.total ?? 0 };
}

function normalizeText(raw: string): string {
  return raw
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
