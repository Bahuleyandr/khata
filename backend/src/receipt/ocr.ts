import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";

const client = new Anthropic({ apiKey: config.anthropicApiKey, maxRetries: 5 });

const RECEIPT_OCR_PROMPT =
  "Extract all visible text from this receipt or bill image. Include merchant name, date, itemised amounts, totals, taxes, and any other printed details, preserving layout with line breaks.";

export async function ocrReceiptImage(
  imageBuffer: Buffer,
  mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp",
): Promise<string> {
  const base64 = imageBuffer.toString("base64");
  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2048,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType, data: base64 },
          },
          { type: "text", text: RECEIPT_OCR_PROMPT },
        ],
      },
    ],
  });
  const block = response.content[0];
  if (!block || block.type !== "text") throw new Error("Unexpected response from Claude vision");
  return block.text;
}
