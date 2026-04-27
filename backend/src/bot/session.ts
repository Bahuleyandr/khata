export interface PendingEdit {
  expenseId: string;
  amount_cents: number;
  currency: string;
  category: string;
  description: string;
  occurred_at: Date;
  // Set when an inline-keyboard button prompts for a follow-up text reply
  waitingFor?: "amount" | "date";
}

// In-memory store keyed by Telegram user ID.
// Survives within a process lifetime; resets on redeploy.
export const pendingEdits = new Map<number, PendingEdit>();
