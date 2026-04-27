// One log line per LLM call: intent, model, transport, latency, success,
// optional token counts. Goes to stdout; pipe to your observability tool, or
// swap the console.log for a DB INSERT later.

export interface UsageEvent {
  intent: string;
  model: string;
  via: "http" | "mcp";
  durationMs: number;
  ok: boolean;
  inputTokens?: number;
  outputTokens?: number;
  err?: string;
}

export function logUsage(event: UsageEvent): void {
  console.log(
    "LLM " +
      JSON.stringify({
        ts: new Date().toISOString(),
        ...event,
      }),
  );
}

interface OpenAIResponseShape {
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/**
 * Wraps an HTTP LLM call (OpenAI-compat shape). Logs success or failure with
 * timing and token counts.
 */
export async function withHttpUsage<T extends OpenAIResponseShape>(
  intent: string,
  model: string,
  fn: () => Promise<T>,
): Promise<T> {
  const start = Date.now();
  try {
    const r = await fn();
    logUsage({
      intent,
      model,
      via: "http",
      durationMs: Date.now() - start,
      ok: true,
      inputTokens: r.usage?.prompt_tokens,
      outputTokens: r.usage?.completion_tokens,
    });
    return r;
  } catch (err) {
    logUsage({
      intent,
      model,
      via: "http",
      durationMs: Date.now() - start,
      ok: false,
      err: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Wraps an MCP tool call. Same as withHttpUsage but no token capture
 * (MCP tool results don't expose token usage to the client).
 */
export async function withMcpUsage<T>(
  intent: string,
  model: string,
  fn: () => Promise<T>,
): Promise<T> {
  const start = Date.now();
  try {
    const r = await fn();
    logUsage({
      intent,
      model,
      via: "mcp",
      durationMs: Date.now() - start,
      ok: true,
    });
    return r;
  } catch (err) {
    logUsage({
      intent,
      model,
      via: "mcp",
      durationMs: Date.now() - start,
      ok: false,
      err: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
