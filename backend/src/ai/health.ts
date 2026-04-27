let lastSuccessAt: Date | null = null;

export function recordClaudeSuccess(): void {
  lastSuccessAt = new Date();
}

export function getLastClaudeSuccess(): Date | null {
  return lastSuccessAt;
}
