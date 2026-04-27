import type { PendingImport } from "./types.js";

// In-memory store keyed by Telegram chat ID (number).
// Single-process scope is acceptable for an MVP with one user.
const pending = new Map<number, PendingImport>();

export function setPendingImport(chatId: number, data: PendingImport): void {
  pending.set(chatId, data);
}

export function getPendingImport(chatId: number): PendingImport | undefined {
  return pending.get(chatId);
}

export function clearPendingImport(chatId: number): void {
  pending.delete(chatId);
}
