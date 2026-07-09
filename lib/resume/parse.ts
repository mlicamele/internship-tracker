import { PDFParse } from "pdf-parse";

export async function parseResumePdf(
  bytes: Buffer
): Promise<{ text: string; pageCount: number }> {
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
