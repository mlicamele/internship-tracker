/**
 * Resume PDF text extraction.
 *
 * Uses `unpdf` — a serverless-native fork of pdfjs-dist with the browser
 * globals (`DOMMatrix`, `ImageData`, `Path2D`) polyfilled internally so the
 * package works on Vercel's Node runtime. Replaces the earlier `pdf-parse`
 * dependency which pulled in raw `pdfjs-dist` and crashed at module init on
 * `ReferenceError: DOMMatrix is not defined`.
 *
 * Kept as a dynamic import inside the function body so the ~1MB bundled
 * pdfjs isn't loaded on every `/settings` render — only when a user
 * actually uploads a PDF. Loading is cheap enough (~50-100ms) that this
 * defer is more about page-load latency than crash-avoidance.
 */

export async function parseResumePdf(
  bytes: Buffer
): Promise<{ text: string; pageCount: number }> {
  const { extractText, getDocumentProxy } = await import("unpdf");

  let totalPages: number;
  let rawText: string;
  try {
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    // With mergePages: true, unpdf's typed overload guarantees text: string.
    const result = await extractText(pdf, { mergePages: true });
    totalPages = result.totalPages;
    rawText = result.text;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not parse PDF: ${detail}`);
  }

  const text = normalizeText(rawText);
  if (!text) {
    throw new Error("Resume PDF contained no extractable text (image-only?)");
  }

  return { text, pageCount: totalPages };
}

function normalizeText(raw: string): string {
  return raw
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
