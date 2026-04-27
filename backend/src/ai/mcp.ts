import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { config } from "../config.js";

// MiniMax MCP client (`minimax-coding-plan-mcp`) — exposes `understand_image`
// and `web_search` tools backed by the MiniMax token plan. We use it for
// vision intents because MiniMax's chat-completions endpoint is text-only.
//
// The MCP server is a Python package launched via `uvx` (must be installed in
// the runner image — see backend/Dockerfile). One subprocess per backend Pod;
// long-lived stdio JSON-RPC connection. On failure we close the client so the
// next call respawns it.

let _client: Client | null = null;
let _connecting: Promise<Client> | null = null;

async function ensureClient(): Promise<Client> {
  if (_client) return _client;
  if (_connecting) return _connecting;

  _connecting = (async () => {
    const transport = new StdioClientTransport({
      command: "uvx",
      args: ["minimax-coding-plan-mcp"],
      env: {
        MINIMAX_API_KEY: config.minimaxApiKey,
        MINIMAX_API_HOST: "https://api.minimax.io",
      },
    });
    const client = new Client(
      { name: "khata-backend", version: "0.1.0" },
      { capabilities: {} },
    );
    await client.connect(transport);
    _client = client;
    return client;
  })();

  try {
    return await _connecting;
  } finally {
    _connecting = null;
  }
}

interface UnderstandImageInput {
  /** Local file path or HTTP/HTTPS URL the MCP server can read. */
  imagePath: string;
  prompt: string;
}

/**
 * Calls MiniMax's `understand_image` MCP tool with the given image and
 * prompt. Returns the model's text response. Throws if the MCP server is
 * unreachable or the response shape is unexpected; on any error the client
 * is dropped so the next call respawns the subprocess.
 */
export async function understandImage(input: UnderstandImageInput): Promise<string> {
  let client: Client;
  try {
    client = await ensureClient();
  } catch (err) {
    _client = null;
    throw new Error(
      `Failed to connect to MiniMax MCP server: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  let result;
  try {
    result = await client.callTool({
      name: "understand_image",
      arguments: {
        image_url: input.imagePath,
        prompt: input.prompt,
      },
    });
  } catch (err) {
    // Drop the client so we reconnect next time (in case the subprocess died)
    await shutdownMcp();
    throw err;
  }

  const content = result.content as Array<{ type: string; text?: string }> | undefined;
  if (!Array.isArray(content)) {
    throw new Error("understand_image returned no content array");
  }
  const textParts = content
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text!);
  if (textParts.length === 0) {
    throw new Error("understand_image returned no text content");
  }
  return textParts.join("\n");
}

/** Cleanly shut down the MCP subprocess. Idempotent. */
export async function shutdownMcp(): Promise<void> {
  if (_client) {
    try {
      await _client.close();
    } catch {
      // ignore close errors
    }
    _client = null;
  }
}
