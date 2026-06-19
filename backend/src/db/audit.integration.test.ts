/**
 * Group AU — audit events must participate in the caller's transaction
 * (audit 2026-06-19 M10). Otherwise a delete/insert that rolls back leaves an
 * orphan audit row, and a successful op that crashes before its audit write
 * loses history — the two were on different connections.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { sql, truncateAll, seedBootstrapOwner } from "../test-support/db-helpers.js";
import { recordAuditEvent } from "./audit.js";

const skip = process.env["INTEGRATION_SKIP"] === "1";
const OWNER_AU = 30001;

async function auditCount(userId: number): Promise<number> {
  const [r] = await sql<Array<{ count: number }>>`
    SELECT COUNT(*)::int AS count FROM audit_log WHERE user_id = ${userId}
  `;
  return r?.count ?? 0;
}

describe.skipIf(skip)("AU: audit events are transactional (M10)", () => {
  beforeEach(async () => {
    await truncateAll();
    await seedBootstrapOwner(OWNER_AU);
  });

  afterAll(async () => {
    // Pool stays open for subsequent describes sharing this fork process.
  });

  it("AU1: recordAuditEvent in a rolled-back tx leaves no audit row", async () => {
    await sql
      .begin(async (tx) => {
        await recordAuditEvent(
          { userId: OWNER_AU, action: "test.rollback", entityType: "expense" },
          tx,
        );
        throw new Error("force rollback");
      })
      .catch(() => {});
    expect(await auditCount(OWNER_AU)).toBe(0);
  });

  it("AU2: recordAuditEvent in a committed tx persists the row", async () => {
    await sql.begin(async (tx) => {
      await recordAuditEvent(
        { userId: OWNER_AU, action: "test.commit", entityType: "expense" },
        tx,
      );
    });
    expect(await auditCount(OWNER_AU)).toBe(1);
  });
});
