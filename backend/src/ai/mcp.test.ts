import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  callTool: vi.fn(),
  close: vi.fn(),
  connect: vi.fn(),
  clientCtor: vi.fn(),
  transportCtor: vi.fn(),
}));

vi.mock("../config.js", () => ({
  config: {
    minimaxApiKey: "test-minimax-key",
  },
}));

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class {
    constructor(...args: unknown[]) {
      mocks.clientCtor(...args);
    }

    callTool = mocks.callTool;
    close = mocks.close;
    connect = mocks.connect;
  },
}));

vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: class {
    constructor(...args: unknown[]) {
      mocks.transportCtor(...args);
    }
  },
}));

describe("understandImage", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.connect.mockResolvedValue(undefined);
    mocks.close.mockResolvedValue(undefined);
    mocks.callTool.mockResolvedValue({
      content: [{ type: "text", text: "extracted receipt text" }],
    });
  });

  it("sends MiniMax MCP the image_source argument expected by understand_image", async () => {
    const { understandImage, shutdownMcp } = await import("./mcp.js");

    await expect(
      understandImage({ imagePath: "/tmp/receipt.jpg", prompt: "read receipt" }),
    ).resolves.toBe("extracted receipt text");

    expect(mocks.callTool).toHaveBeenCalledWith({
      name: "understand_image",
      arguments: {
        image_source: "/tmp/receipt.jpg",
        prompt: "read receipt",
      },
    });

    await shutdownMcp();
  });

  it("throws when the MCP tool returns an error as text content", async () => {
    mocks.callTool.mockResolvedValueOnce({
      content: [
        {
          type: "text",
          text: "Error executing tool understand_image: image_source field required",
        },
      ],
    });
    const { understandImage } = await import("./mcp.js");

    await expect(
      understandImage({ imagePath: "/tmp/receipt.jpg", prompt: "read receipt" }),
    ).rejects.toThrow("image_source field required");
    expect(mocks.close).toHaveBeenCalled();
  });
});
