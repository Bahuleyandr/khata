import { describe, it, expect, vi, beforeEach } from "vitest";

const { sqlMock } = vi.hoisted(() => ({
  sqlMock: vi.fn().mockResolvedValue([]),
}));

vi.mock("../db/index.js", () => ({ sql: sqlMock }));

vi.mock("../db/budgets.js", () => ({
  getBudgetsWithMtd: vi.fn().mockResolvedValue([]),
  getDigestState: vi.fn().mockResolvedValue(0),
  upsertDigestState: vi.fn().mockResolvedValue(undefined),
  getDistinctUsersWithBudgets: vi.fn().mockResolvedValue([]),
}));

import { expireOldBotSessions } from "./budgets.js";

describe("expireOldBotSessions", () => {
  beforeEach(() => {
    sqlMock.mockClear();
  });

  it("issues DELETE for expired bot_sessions rows", async () => {
    await expireOldBotSessions();
    expect(sqlMock).toHaveBeenCalledOnce();
    const [strings] = sqlMock.mock.calls[0];
    const fragment = (strings as TemplateStringsArray).join("").toLowerCase();
    expect(fragment).toContain("delete from bot_sessions");
    expect(fragment).toContain("expires_at < now()");
  });
});
