import { describe, it, expect, vi } from "vitest";

vi.mock("../config.js", () => ({
  config: {
    sessionSecret: "test-secret-that-is-at-least-32-chars-long",
    s3: { endpoint: "", bucket: "", region: "auto" },
    allowedOrigins: [],
  },
}));

vi.mock("../db/index.js", () => ({ sql: vi.fn() }));
vi.mock("../storage/index.js", () => ({ getStatementDownloadUrl: vi.fn() }));

import { signSession, verifySession } from "./dashboard.js";

const NOW = Math.floor(Date.now() / 1000);

describe("verifySession", () => {
  it("accepts a token issued now", () => {
    const token = signSession(1, "Alice", NOW);
    expect(verifySession(token)).toEqual({ userId: 1, firstName: "Alice" });
  });

  it("accepts a token issued 6 days ago (within window)", () => {
    const iat = NOW - 6 * 24 * 3600;
    const token = signSession(1, "Alice", iat);
    expect(verifySession(token)).toEqual({ userId: 1, firstName: "Alice" });
  });

  it("rejects a token issued exactly 7 days + 1 second ago", () => {
    const iat = NOW - 604801;
    const token = signSession(1, "Alice", iat);
    expect(verifySession(token)).toBeNull();
  });

  it("rejects a token issued 8 days ago with a valid signature", () => {
    const iat = NOW - 8 * 24 * 3600;
    const token = signSession(1, "Alice", iat);
    expect(verifySession(token)).toBeNull();
  });

  it("rejects a tampered token", () => {
    const token = signSession(1, "Alice", NOW);
    const tampered = token.slice(0, -4) + "ffff";
    expect(verifySession(tampered)).toBeNull();
  });

  it("rejects a token with no dot separator", () => {
    expect(verifySession("nodot")).toBeNull();
  });
});
