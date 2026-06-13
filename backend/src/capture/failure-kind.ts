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
