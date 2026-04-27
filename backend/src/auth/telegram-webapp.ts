import crypto from "node:crypto";
import { config } from "../config.js";

/**
 * Validation of Telegram Mini App `initData` (the query-string the WebApp
 * SDK exposes via `Telegram.WebApp.initData`).
 *
 * Algorithm — distinct from Telegram-Login OAuth (`verifyTelegramHash` in
 * routes/auth.ts) because the secret derivation is different:
 *   1. Parse initData as URLSearchParams. Pull out `hash`.
 *   2. Sort remaining keys, join `key=value` lines with '\n' → check_string.
 *   3. secret_key = HMAC_SHA256(key="WebAppData", data=bot_token)
 *   4. expected_hash = HMAC_SHA256(key=secret_key, data=check_string)
 *   5. Constant-time compare expected_hash with provided `hash`.
 *   6. Reject if `auth_date` is older than MAX_AGE_S.
 *
 * Reference: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */

export interface WebAppUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export type WebAppValidationResult =
  | { ok: true; user: WebAppUser; authDate: number }
  | { ok: false; error: string };

// 24h — long enough to stay logged in across a session, short enough that a
// stolen initData can't grant indefinite access.
const MAX_AGE_S = 24 * 60 * 60;

export function verifyWebAppInitData(initData: string): WebAppValidationResult {
  if (!initData) return { ok: false, error: "empty initData" };

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(initData);
  } catch {
    return { ok: false, error: "malformed initData" };
  }

  const hash = params.get("hash");
  if (!hash) return { ok: false, error: "missing hash" };

  // Build check_string. Telegram requires sorted keys and `key=value` lines
  // joined with literal newlines.
  const keys = [...params.keys()].filter((k) => k !== "hash").sort();
  const checkString = keys.map((k) => `${k}=${params.get(k)}`).join("\n");

  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(config.telegramBotToken)
    .digest();
  const expectedHash = crypto
    .createHmac("sha256", secretKey)
    .update(checkString)
    .digest("hex");

  let valid = false;
  try {
    valid = crypto.timingSafeEqual(
      Buffer.from(expectedHash, "hex"),
      Buffer.from(hash, "hex"),
    );
  } catch {
    return { ok: false, error: "invalid hash format" };
  }
  if (!valid) return { ok: false, error: "invalid signature" };

  const authDate = parseInt(params.get("auth_date") ?? "0", 10);
  if (!authDate || Number.isNaN(authDate)) {
    return { ok: false, error: "missing auth_date" };
  }
  if (Math.floor(Date.now() / 1000) - authDate > MAX_AGE_S) {
    return { ok: false, error: "expired" };
  }

  const userJson = params.get("user");
  if (!userJson) return { ok: false, error: "missing user" };
  let user: WebAppUser;
  try {
    user = JSON.parse(userJson) as WebAppUser;
  } catch {
    return { ok: false, error: "malformed user json" };
  }
  if (typeof user.id !== "number" || !user.first_name) {
    return { ok: false, error: "invalid user fields" };
  }

  return { ok: true, user, authDate };
}
