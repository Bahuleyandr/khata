import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import { withRetry } from "../ai/retry.js";
import { insertClaudeUsage } from "../db/usage.js";
import { recordClaudeSuccess } from "../ai/health.js";

const client = new Anthropic({ apiKey: config.anthropicApiKey });

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB

const RECEIPT_OCR_SYSTEM =
  "Extract all visible text from this receipt or bill image. Include merchant name, date, itemised amounts, totals, taxes, and any other printed details, preserving layout with line breaks.";

interface ExtendedUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

export async function ocrReceiptImage(
  imageBuffer: Buffer,
  mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp",
): Promise<string> {
  if (imageBuffer.length > MAX_IMAGE_BYTES) {
    throw new Error(
      `Image too large (${(imageBuffer.length / 1024 / 1024).toFixed(1)} MB). Maximum allowed is 5 MB.`,
    );
  }

  const base64 = imageBuffer.toString("base64");
  const response = await withRetry(
    () =>
      client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 2048,
        system: [{ type: "text", text: RECEIPT_OCR_SYSTEM, cache_control: { type: "ephemeral" } }],
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: mediaType, data: base64 },
              },
            ],
          },
        ],
      }),
    "receiptOCR",
  );

  recordClaudeSuccess();
  const usage = response.usage as ExtendedUsage;
  void insertClaudeUsage({
    intent: "receiptOCR",
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    cache_read_tokens: usage.cache_read_input_tokens ?? 0,
    cache_creation_tokens: usage.cache_creation_input_tokens ?? 0,
    model: response.model,
  }).catch((err) => console.error("[usage] Failed to log receiptOCR:", err));

  const block = response.content[0];
  if (!block || block.type !== "text") throw new Error("Unexpected response from Claude vision");
  return block.text;
}
