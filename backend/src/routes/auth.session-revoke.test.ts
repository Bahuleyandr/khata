import { describe, it, expect, vi } from "vitest";
vi.mock("../config.js", () => ({
  config: {
    telegramBotToken: "x", sessionSecret: "test-secret-that-is-at-least-32-chars-long",
    allowedTelegramUserIds: [12345], allowedOrigins: ["http://localhost:3000"],
    databaseUrl: "postgres://unused",
    s3: { endpoint: "x", bucket: "x", region: "x", accessKeyId: "x", secretAccessKey: "x" },
  },
}));
import { isSessionRevoked } from "./auth.js";

describe("isSessionRevoked", () => {
  it("is false when there is no revocation epoch", () => {
    expect(isSessionRevoked(1_700_000_000, null)).toBe(false);
  });
  it("is true when the token was issued before the epoch", () => {
    const iat = 1_700_000_000; // seconds
    const invalidBefore = new Date((iat + 60) * 1000); // 60s later
    expect(isSessionRevoked(iat, invalidBefore)).toBe(true);
  });
  it("is false when the token was issued at/after the epoch", () => {
    const iat = 1_700_000_000;
    const invalidBefore = new Date((iat - 60) * 1000);
    expect(isSessionRevoked(iat, invalidBefore)).toBe(false);
  });
});
