import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "../config.js";
import { understandImage } from "../ai/mcp.js";
import { withMcpUsage } from "../ai/usage.js";

const RECEIPT_OCR_PROMPT =
  "Extract all visible text from this receipt or bill image. Include merchant name, date, itemised amounts, totals, taxes, and any other printed details, preserving layout with line breaks.";

export async function ocrReceiptImage(
  imageBuffer: Buffer,
  mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp",
): Promise<string> {
  // MCP `understand_image` reads a file path; write the buffer to a temp file
  // for the duration of the call (same-Pod filesystem is shared with the
  // Python MCP subprocess).
  const ext = mediaType.split("/")[1];
  const dir = await mkdtemp(join(tmpdir(), "khata-receipt-"));
  const filePath = join(dir, `receipt.${ext}`);
  await writeFile(filePath, imageBuffer);

  try {
    return await withMcpUsage(
      "ocrReceiptImage",
      config.models.ocrReceiptImage,
      () => understandImage({ imagePath: filePath, prompt: RECEIPT_OCR_PROMPT }),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
