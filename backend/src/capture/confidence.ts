export interface CaptureConfidence {
  overall: number;
  amount: number;
  date: number;
  merchant: number;
  category: number;
  account: number;
  source: number;
  reasons: string[];
}

export type ReviewStatus = "needs_review" | "reviewed" | "ignored";

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function buildCaptureConfidence(input: {
  amountCents?: number | null;
  occurredAt?: Date | null;
  merchant?: string | null;
  description?: string | null;
  categoryId?: string | null;
  accountId?: string | null;
  source: string;
  ruleId?: string | null;
  parser?: "upi_regex" | "receipt_regex" | "llm" | "manual" | "statement" | "voice";
  rawText?: string | null;
}): CaptureConfidence {
  const reasons: string[] = [];
  const amount = input.amountCents && input.amountCents > 0 ? 100 : 25;
  if (amount < 100) reasons.push("amount_missing");

  const now = Date.now();
  const occurredAtTime = input.occurredAt?.getTime();
  const date =
    occurredAtTime && Number.isFinite(occurredAtTime)
      ? occurredAtTime <= now + 36 * 60 * 60 * 1000
        ? 95
        : 45
      : 35;
  if (date < 80) reasons.push("date_uncertain");

  const merchant = input.merchant?.trim()
    ? 95
    : input.description?.trim()
      ? 70
      : 25;
  if (merchant < 80) reasons.push("merchant_uncertain");

  const category = input.categoryId ? (input.ruleId ? 96 : 86) : 35;
  if (category < 80) reasons.push("category_missing");

  const account = input.accountId ? 92 : 55;
  if (account < 80) reasons.push("account_unmatched");

  const parserScores: Record<string, number> = {
    upi_regex: 98,
    receipt_regex: 88,
    statement: 88,
    manual: 96,
    voice: 78,
    llm: 74,
  };
  const source = parserScores[input.parser ?? "llm"] ?? 72;
  if (source < 80) reasons.push("parser_needs_review");

  const rawPenalty =
    input.rawText && input.rawText.length < 20 && input.source !== "manual" ? 8 : 0;
  const overall = clamp(
    amount * 0.22 +
      date * 0.14 +
      merchant * 0.16 +
      category * 0.2 +
      account * 0.12 +
      source * 0.16 -
      rawPenalty,
  );

  return {
    overall,
    amount,
    date,
    merchant,
    category,
    account,
    source,
    reasons: Array.from(new Set(reasons)),
  };
}

export function reviewStatusFromConfidence(
  requested: ReviewStatus | undefined,
  confidence: CaptureConfidence,
): ReviewStatus {
  if (requested === "ignored") return requested;
  if (requested === "needs_review") return requested;
  return confidence.overall >= 82 ? "reviewed" : "needs_review";
}

export function confidenceLabel(confidence: CaptureConfidence | null | undefined): string {
  if (!confidence) return "unknown";
  if (confidence.overall >= 90) return "high";
  if (confidence.overall >= 75) return "medium";
  return "low";
}
