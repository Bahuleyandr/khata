/**
 * Group R — Receipt-attach uuid=text JOIN regression (PUT .../receipt)
 * Group M — Merge uuid=text JOIN regression (POST .../merge)
 *
 * These tests prove that expenses with a non-null account_id no longer
 * trigger "operator does not exist: uuid = text" when the CTE projects
 * account_id into an outer LEFT JOIN accounts a ON a.id = updated.account_id.
 *
 * Before the fix both handlers 500'd whenever account_id was set; after the
 * fix (remove the unnecessary ::text cast from the CTE RETURNING clause) they
 * return 200/expected and account_id round-trips correctly.
 */
import { vi } from "vitest";

// Mock S3 storage so the receipt handler doesn't need a live MinIO instance.
// vi.mock is hoisted by vitest to before any imports, so the mock is in place
// when the Fastify app registers the expenses routes.
vi.mock("../storage/index.js", () => ({
  uploadStatement: vi.fn().mockResolvedValue(undefined),
  getStatementDownloadUrl: vi.fn().mockResolvedValue("https://example.com/mock-url"),
  deleteStatement: vi.fn().mockResolvedValue(undefined),
}));

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  truncateAll,
  seedBootstrapOwner,
  seedAccount,
  insertRawExpense,
} from "../test-support/db-helpers.js";
import { buildRealApp, makeSessionCookie } from "../test-support/app-helpers.js";

const skip = process.env["INTEGRATION_SKIP"] === "1";

const OWNER_R = 40001;
const OWNER_M = 40002;

// ─────────────────────────────────────────────────────────────────────────────
// Group R — Receipt-attach: non-null account_id must not produce uuid=text error
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(skip)("R: receipt-attach uuid=text regression", () => {
  let app: FastifyInstance;
  let accountId: string;
  let expenseId: string;

  beforeEach(async () => {
    await truncateAll();
    await seedBootstrapOwner(OWNER_R);
    accountId = await seedAccount(OWNER_R, "SBI Savings");
    expenseId = await insertRawExpense({
      userId: OWNER_R,
      amountCents: 1500,
      occurredAt: "2026-05-20T08:00:00Z",
      accountId,
    });
    app = await buildRealApp();
  });

  afterAll(async () => {
    await app?.close();
    // Pool stays open for subsequent describes sharing this fork process.
  });

  it("R1: POST receipt on expense with non-null account_id returns 200 and round-trips account_id", async () => {
    const cookie = makeSessionCookie(OWNER_R, "Owner");

    const boundary = "----khata-test-boundary-r1";
    const payload = Buffer.from(
      [
        `--${boundary}`,
        'Content-Disposition: form-data; name="receipt"; filename="receipt.jpg"',
        "Content-Type: image/jpeg",
        "",
        // Minimal valid JPEG bytes (enough to pass mimetype check)
        "\xFF\xD8\xFF\xE0\x00\x10JFIF test",
        `--${boundary}--`,
        "",
      ].join("\r\n"),
    );

    const res = await app.inject({
      method: "POST",
      url: `/api/expenses/${expenseId}/receipt`,
      headers: {
        "Cookie": `session=${cookie}`,
        "Origin": "http://localhost:3000",
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "x-khata-ledger-id": String(OWNER_R),
      },
      payload,
    });

    // Before the fix this 500'd with: operator does not exist: uuid = text
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { account_id?: string; account?: string };
    expect(body.account_id).toBe(accountId);
    expect(body.account).toBe("SBI Savings");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group M — Merge: non-null account_id must not produce uuid=text error
// ─────────────────────────────────────────────────────────────────────────────

describe.skipIf(skip)("M: merge uuid=text regression", () => {
  let app: FastifyInstance;
  let accountId: string;
  let keeperId: string;
  let duplicateId: string;

  beforeEach(async () => {
    await truncateAll();
    await seedBootstrapOwner(OWNER_M);
    accountId = await seedAccount(OWNER_M, "HDFC Card");
    // Keeper expense has account_id set — this is what triggers the bug
    // when the CTE projects account_id::text and the outer query JOINs on it.
    keeperId = await insertRawExpense({
      userId: OWNER_M,
      amountCents: 2500,
      occurredAt: "2026-05-21T09:00:00Z",
      accountId,
    });
    // Duplicate to be merged away (account_id can be null)
    duplicateId = await insertRawExpense({
      userId: OWNER_M,
      amountCents: 2500,
      occurredAt: "2026-05-21T09:01:00Z",
    });
    app = await buildRealApp();
  });

  afterAll(async () => {
    await app?.close();
    // Pool stays open for subsequent describes sharing this fork process.
  });

  it("M1: POST merge on expense with non-null account_id returns 200 and round-trips account_id", async () => {
    const cookie = makeSessionCookie(OWNER_M, "Owner");

    const res = await app.inject({
      method: "POST",
      url: `/api/expenses/${keeperId}/merge`,
      headers: {
        "Cookie": `session=${cookie}`,
        "Origin": "http://localhost:3000",
        "Content-Type": "application/json",
        "x-khata-ledger-id": String(OWNER_M),
      },
      payload: {
        duplicateId,
      },
    });

    // Before the fix this 500'd with: operator does not exist: uuid = text
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { ok?: boolean; expense?: { account_id?: string; account?: string } };
    expect(body.ok).toBe(true);
    expect(body.expense?.account_id).toBe(accountId);
    expect(body.expense?.account).toBe("HDFC Card");
  });
});
