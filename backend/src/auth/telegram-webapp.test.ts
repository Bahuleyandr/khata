import { describe, it, expect, vi } from "vitest";
import crypto from "node:crypto";

// vi.mock factories run before module-level `const`s in the same file (vitest
// hoists them). Use vi.hoisted() so the test bot token is in scope for both
// the mock and the test bodies below.
const { TEST_BOT_TOKEN } = vi.hoisted(() => ({
  TEST_BOT_TOKEN: "1234567890:test-bot-token-for-unit-tests", // secret-scan: allow
}));

vi.mock("../config.js", () => ({
  config: {
    telegramBotToken: TEST_BOT_TOKEN,
  },
}));

import { verifyWebAppInitData } from "./telegram-webapp.js";

interface InitDataFields {
  user: { id: number; first_name: string; username?: string };
  authDate?: number;
  queryId?: string;
}

/**
 * Crafts a valid initData string the same way Telegram does, so the verifier
 * test path actually exercises the full HMAC chain rather than mocking
 * around it.
 */
function buildInitData(botToken: string, fields: InitDataFields): string {
  const params = new URLSearchParams();
  params.set("user", JSON.stringify(fields.user));
  params.set("auth_date", String(fields.authDate ?? Math.floor(Date.now() / 1000)));
  if (fields.queryId) params.set("query_id", fields.queryId);

  const sorted = [...params.keys()]
    .sort()
    .map((k) => `${k}=${params.get(k)}`)
    .join("\n");
  const secretKey = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = crypto.createHmac("sha256", secretKey).update(sorted).digest("hex");
  params.set("hash", hash);
  return params.toString();
}

describe("verifyWebAppInitData", () => {
  it("accepts well-formed, fresh initData and returns the user", () => {
    const initData = buildInitData(TEST_BOT_TOKEN, {
      user: { id: 555, first_name: "Subash", username: "subash" },
      queryId: "AAFm1234",
    });
    const result = verifyWebAppInitData(initData);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.user.id).toBe(555);
      expect(result.user.first_name).toBe("Subash");
      expect(result.user.username).toBe("subash");
    }
  });

  it("rejects when the hash was computed with the wrong bot token", () => {
    const initData = buildInitData("OTHER:wrong-token", {
      user: { id: 555, first_name: "Subash" },
    });
    const result = verifyWebAppInitData(initData);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("invalid signature");
  });

  it("rejects when initData is missing the hash field", () => {
    const result = verifyWebAppInitData("user=%7B%7D&auth_date=1234567890");
    expect(result).toEqual({ ok: false, error: "missing hash" });
  });

  it("rejects empty input", () => {
    expect(verifyWebAppInitData("")).toEqual({ ok: false, error: "empty initData" });
  });

  it("rejects when auth_date is older than 24 hours", () => {
    const stale = Math.floor(Date.now() / 1000) - 25 * 3600;
    const initData = buildInitData(TEST_BOT_TOKEN, {
      user: { id: 555, first_name: "Subash" },
      authDate: stale,
    });
    const result = verifyWebAppInitData(initData);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("expired");
  });

  it("rejects when auth_date is too far in the future", () => {
    const future = Math.floor(Date.now() / 1000) + 120;
    const initData = buildInitData(TEST_BOT_TOKEN, {
      user: { id: 555, first_name: "Subash" },
      authDate: future,
    });
    const result = verifyWebAppInitData(initData);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("future auth_date");
  });

  it("rejects when user JSON is missing first_name", () => {
    // Build manually since buildInitData requires first_name
    const params = new URLSearchParams();
    params.set("user", JSON.stringify({ id: 555 }));
    params.set("auth_date", String(Math.floor(Date.now() / 1000)));
    const sorted = [...params.keys()]
      .sort()
      .map((k) => `${k}=${params.get(k)}`)
      .join("\n");
    const secretKey = crypto
      .createHmac("sha256", "WebAppData")
      .update(TEST_BOT_TOKEN)
      .digest();
    const hash = crypto.createHmac("sha256", secretKey).update(sorted).digest("hex");
    params.set("hash", hash);

    const result = verifyWebAppInitData(params.toString());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("invalid user fields");
  });

  it("rejects when the hash is well-formed hex but wrong", () => {
    const initData = buildInitData(TEST_BOT_TOKEN, {
      user: { id: 555, first_name: "Subash" },
    });
    // Replace the hash with an unrelated valid-hex string of the same length
    const tampered = initData.replace(
      /hash=[a-f0-9]+/,
      "hash=" + "0".repeat(64),
    );
    const result = verifyWebAppInitData(tampered);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("invalid signature");
  });
});
