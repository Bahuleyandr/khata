// Single-line structured log of every LLM call: intent, model, tokens, ms, ok.
// Stdout-only for now; if a `claude_usage` table is wanted later, swap the
// console.log for an INSERT here without touching call sites.

interface UsageShape {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

interface ResponseWithUsage {
  usage?: UsageShape;
}

export function logUsage(
  intent: string,
  model: string,
  response: ResponseWithUsage,
  durationMs: number,
): void {
  console.log(
    "LLM " +
      JSON.stringify({
        ts: new Date().toISOString(),
        intent,
        model,
        input_tokens: response?.usage?.prompt_tokens ?? 0,
        output_tokens: response?.usage?.completion_tokens ?? 0,
        duration_ms: durationMs,
        ok: true,
      }),
  );
}

export function logUsageError(
  intent: string,
  model: string,
  err: unknown,
  durationMs: number,
): void {
  console.log(
    "LLM " +
      JSON.stringify({
        ts: new Date().toISOString(),
        intent,
        model,
        duration_ms: durationMs,
        ok: false,
        err: err instanceof Error ? err.message : String(err),
      }),
  );
}
