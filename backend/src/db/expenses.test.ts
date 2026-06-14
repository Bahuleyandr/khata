import { describe, it, expect, vi, beforeEach } from "vitest";

const { sqlMock, recordAuditMock, merchantMock } = vi.hoisted(() => {
  const sqlMock: ReturnType<typeof vi.fn> & { begin?: ReturnType<typeof vi.fn> } = vi.fn();
  sqlMock.begin = vi.fn(async (cb: (tx: unknown) => unknown) => cb(sqlMock));
  return {
    sqlMock,
    recordAuditMock: vi.fn().mockResolvedValue("audit-1"),
    merchantMock: vi.fn().mockResolvedValue(null),
  };
});

vi.mock("./index.js", () => ({ sql: sqlMock }));
vi.mock("./audit.js", () => ({ recordAuditEvent: recordAuditMock }));
vi.mock("./merchants.js", () => ({ getOrCreateMerchantCanonical: merchantMock }));

import { updateExpenseAmount, insertExpense } from "./expenses.js";

beforeEach(() => {
  sqlMock.mockReset();
  sqlMock.begin!.mockReset().mockImplementation(async (cb: (tx: unknown) => unknown) => cb(sqlMock));
  recordAuditMock.mockReset().mockResolvedValue("audit-1");
  merchantMock.mockReset().mockResolvedValue(null);
});

const beforeRow = {
  id: "exp-1",
  amount_cents: "1000",
  currency: "INR",
  occurred_at: new Date("2026-04-15T12:00:00Z"),
  settlement_scope: "personal",
  confidence: {},
};

describe("updateExpenseAmount", () => {
  it("records an expense.update audit event with before/after in the same transaction", async () => {
    const afterRow = { ...beforeRow, amount_cents: "2000" };
    sqlMock.mockResolvedValueOnce([beforeRow]).mockResolvedValueOnce([afterRow]);

    const ok = await updateExpenseAmount("exp-1", 111, 2000, "INR", 999);

    expect(ok).toBe(true);
    expect(sqlMock.begin).toHaveBeenCalledOnce();
    expect(recordAuditMock).toHaveBeenCalledOnce();
    expect(recordAuditMock.mock.calls[0]![0]).toMatchObject({
      userId: 111,
      actorUserId: 999,
      action: "expense.update",
      entityType: "expense",
      entityId: "exp-1",
      before: beforeRow,
      after: afterRow,
    });
  });

  it("returns false and records nothing when the expense is not found", async () => {
    sqlMock.mockResolvedValueOnce([]); // SELECT ... FOR UPDATE finds nothing

    const ok = await updateExpenseAmount("missing", 111, 2000, "INR", 999);

    expect(ok).toBe(false);
    expect(recordAuditMock).not.toHaveBeenCalled();
  });
});

describe("insertExpense", () => {
  it("records an expense.create audit event carrying the created row", async () => {
    const created = {
      id: "exp-new",
      amount_cents: "5000",
      currency: "INR",
      occurred_at: new Date("2026-04-20T12:00:00Z"),
      settlement_scope: "personal",
      confidence: {},
    };
    sqlMock.mockResolvedValueOnce([created]);

    const id = await insertExpense({
      userId: 111,
      amount_cents: 5000,
      currency: "INR",
      description: "Coffee",
      merchant: null,
      category_id: null,
      occurred_at: new Date("2026-04-20T12:00:00Z"),
      source: "telegram",
      raw_text: null,
      actorUserId: 999,
    });

    expect(id).toBe("exp-new");
    expect(recordAuditMock).toHaveBeenCalledOnce();
    expect(recordAuditMock.mock.calls[0]![0]).toMatchObject({
      userId: 111,
      actorUserId: 999,
      action: "expense.create",
      entityType: "expense",
      entityId: "exp-new",
      after: created,
    });
  });
});
