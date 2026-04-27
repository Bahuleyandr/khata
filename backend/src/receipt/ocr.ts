import { config } from "../config.js";
import { llm } from "../ai/client.js";
import { logUsage, logUsageError } from "../ai/usage.js";

const RECEIPT_OCR_PROMPT =
  "Extract all visible text from this receipt or bill image. Include merchant name, date, itemised amounts, totals, taxes, and any other printed details, preserving layout with line breaks.";

export async function ocrReceiptImage(
  imageBuffer: Buffer,
  mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp",
): Promise<string> {
  const dataUrl = `data:${mediaType};base64,${imageBuffer.toString("base64")}`;
  const model = config.models.ocrReceiptImage;
  const start = Date.now();
  let response;
  try {
    response = await llm.chat.completions.create({
      model,
      max_tokens: 2048,
      messages: [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: dataUrl } },
            { type: "text", text: RECEIPT_OCR_PROMPT },
          ],
        },
      ],
    });
  } catch (err) {
    logUsageError("ocrReceiptImage", model, err, Date.now() - start);
    throw err;
  }
  logUsage("ocrReceiptImage", model, response, Date.now() - start);

  const content = response.choices[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error("Unexpected response type from receipt OCR call");
  }
  return content;
}
