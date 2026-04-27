export interface ParsedTransaction {
  date: string;           // ISO 8601 YYYY-MM-DD
  description: string;
  amountCents: number;    // positive = debit/charge, negative = credit/refund
  currency: string;       // e.g. "INR"
  suggestedCategory: string;
}

export interface DedupeResult {
  transaction: ParsedTransaction;
  alreadyLogged: boolean;
  matchedExpenseId?: string;
}

export interface PendingImport {
  statementId: string;
  results: DedupeResult[];
  totalCount: number;
  alreadyLoggedCount: number;
  newCount: number;
}
