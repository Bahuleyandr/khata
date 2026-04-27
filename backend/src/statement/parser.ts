import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFParse } from "pdf-parse";
import { config } from "../config.js";
import { llm } from "../ai/client.js";
import { understandImage } from "../ai/mcp.js";
import { withHttpUsage, withMcpUsage } from "../ai/usage.js";
import type { ParsedTransaction } from "./types.js";

const NORMALIZATION_SYSTEM = `You are a financial data extractor. Extract all debit/credit transactions from bank or credit card statement text.

Return a JSON array where each element has:
- date: ISO 8601 date (YYYY-MM-DD)
- description: merchant or transaction description
- amountCents: integer, positive = debit/charge, negative = credit/refund, converted to smallest unit (paise for INR, cents for USD)
- currency: 3-letter ISO code (default "INR" if unclear)
- suggestedCategory: one of Food, Transport, Shopping, Entertainment, Health, Bills, Travel, Other

Rules:
- Skip opening/closing balances, totals, and header rows
- Combine split rows that belong to one transaction
- If amount is ambiguous, treat it as a debit

Return ONLY valid JSON array. No markdown, no explanation.`;

const STATEMENT_VISION_PROMPT =
  "Extract all text from this bank/credit card statement image. Preserve table structure using spaces and newlines.";

export async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  const result = await parser.getText();
  await parser.destroy();
  return result.text;
}

export async function extractTextFromImage(
  imageBuffer: Buffer,
  mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp",
): Promise<string> {
  // MCP `understand_image` reads a file path; write the buffer to a temp file
  // for the duration of the call. Same Pod = same filesystem, so the Python
  // MCP subprocess can read what we wrote here.
  const ext = mediaType.split("/")[1];
  const dir = await mkdtemp(join(tmpdir(), "khata-img-"));
  const filePath = join(dir, `statement.${ext}`);
  await writeFile(filePath, imageBuffer);

  try {
    return await withMcpUsage(
      "extractTextFromImage",
      config.models.extractTextFromImage,
      () => understandImage({ imagePath: filePath, prompt: STATEMENT_VISION_PROMPT }),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function normalizeTransactions(rawText: string): Promise<ParsedTransaction[]> {
  const model = config.models.normalizeTransactions;
  const response = await withHttpUsage("normalizeTransactions", model, () =>
    llm.chat.completions.create({
      model,
      max_tokens: 4096,
      messages: [
        { role: "system", content: NORMALIZATION_SYSTEM },
        { role: "user", content: rawText },
      ],
    }),
  );

  const text = response.choices[0]?.message?.content;
  if (typeof text !== "string") {
    throw new Error("Unexpected response type from normalization call");
  }

  const trimmed = text.trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    // Some models wrap in a code fence despite instructions
    const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (!match) throw new Error(`Model returned non-JSON: ${trimmed.slice(0, 200)}`);
    parsed = JSON.parse(match[1]!);
  }
  if (!Array.isArray(parsed)) throw new Error("Expected JSON array from normalization");
  return parsed as ParsedTransaction[];
}

export async function parseStatementBuffer(
  buffer: Buffer,
  mimeType: string,
): Promise<ParsedTransaction[]> {
  let rawText: string;

  if (mimeType === "application/pdf") {
    rawText = await extractTextFromPdf(buffer);
    // If text extraction yielded almost nothing it's a scanned (image) PDF
    if (rawText.replace(/\s/g, "").length < 80) {
      throw new Error(
        "This PDF appears to be scanned with no embedded text. Please photograph each page and send the images instead.",
      );
    }
  } else if (
    mimeType === "image/jpeg" ||
    mimeType === "image/png" ||
    mimeType === "image/gif" ||
    mimeType === "image/webp"
  ) {
    rawText = await extractTextFromImage(
      buffer,
      mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
    );
  } else {
    throw new Error(`Unsupported file type: ${mimeType}`);
  }

  return normalizeTransactions(rawText);
}
