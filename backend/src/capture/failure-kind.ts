export type CaptureFailureKind =
  | "no_text"
  | "not_receipt"
  | "no_transactions"
  | "parse_error"
  | "ocr_error"
  | "duplicate"
  | "unsupported_file"
  | "oversize"
  | "unknown";

export const CAPTURE_FAILURE_KINDS: CaptureFailureKind[] = [
  "no_text",
  "not_receipt",
  "no_transactions",
  "parse_error",
  "ocr_error",
  "duplicate",
  "unsupported_file",
  "oversize",
  "unknown",
];

export interface CaptureFailureDiagnosis {
  title: string;
  detail: string;
  next_action: string;
  replayable: boolean;
}

export function classifyCaptureFailure(reason: string | null | undefined): CaptureFailureKind {
  const text = (reason ?? "").toLowerCase();
  if (!text) return "unknown";
  if (/too little text|couldn't read enough|no text|empty/.test(text)) return "no_text";
  if (/not classified|doesn't look like|not a receipt|found no expense/.test(text)) return "not_receipt";
  if (/no transactions found/.test(text)) return "no_transactions";
  if (/ocr failed|vision|understand_image/.test(text)) return "ocr_error";
  if (/duplicate|already logged/.test(text)) return "duplicate";
  if (/unsupported file|unsupported/.test(text)) return "unsupported_file";
  if (/too large|file size|oversize/.test(text)) return "oversize";
  if (/parse|classify|extract|invalid|failed/.test(text)) return "parse_error";
  return "unknown";
}

export function diagnoseCaptureFailure(
  kind: CaptureFailureKind,
  reason: string | null | undefined,
): CaptureFailureDiagnosis {
  const trimmedReason = (reason ?? "").trim();
  const suffix = trimmedReason ? ` Latest reason: ${trimmedReason}` : "";
  switch (kind) {
    case "no_text":
      return {
        title: "OCR found too little text",
        detail: `The image/file reached Khata, but the text extractor did not return enough usable text.${suffix}`,
        next_action: "Ask for a clearer photo, or manually add the amount and merchant from the capture.",
        replayable: true,
      };
    case "not_receipt":
      return {
        title: "Capture was not recognized as an expense",
        detail: `Khata received text, but the classifier/parser decided it was not a bill, receipt, UPI alert, or expense.${suffix}`,
        next_action: "If it is a real spend, create a smart rule from the raw text and replay it.",
        replayable: true,
      };
    case "no_transactions":
      return {
        title: "No statement rows were found",
        detail: `The statement parser ran but did not extract any transaction rows.${suffix}`,
        next_action: "Open the statement review flow, retry with a clearer PDF/image, or import rows manually.",
        replayable: true,
      };
    case "parse_error":
      return {
        title: "Parser/classifier failed",
        detail: `The capture looked relevant, but parsing failed before an expense could be saved.${suffix}`,
        next_action: "Replay after rule/parser changes, or create a manual transaction from the raw text.",
        replayable: true,
      };
    case "ocr_error":
      return {
        title: "Vision/OCR provider failed",
        detail: `The image pipeline failed before reliable text could be extracted.${suffix}`,
        next_action: "Replay later; if it repeats, check MiniMax/MCP health and the source image.",
        replayable: true,
      };
    case "duplicate":
      return {
        title: "Likely duplicate",
        detail: `Khata found an existing transaction or content hash that looks equivalent.${suffix}`,
        next_action: "Leave it ignored unless the existing transaction is wrong.",
        replayable: false,
      };
    case "unsupported_file":
      return {
        title: "Unsupported file type",
        detail: `The upload type is not handled by the current parser pipeline.${suffix}`,
        next_action: "Upload a PDF/image or enter the expense manually.",
        replayable: false,
      };
    case "oversize":
      return {
        title: "File too large",
        detail: `The capture was rejected before parsing because it exceeded size limits.${suffix}`,
        next_action: "Compress or crop the file, then upload it again.",
        replayable: false,
      };
    case "unknown":
    default:
      return {
        title: "Unknown capture failure",
        detail: `Khata could not confidently classify this failure.${suffix}`,
        next_action: "Inspect raw text/metadata, then replay or ignore.",
        replayable: true,
      };
  }
}
