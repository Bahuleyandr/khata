import { describe, it, expect, vi, beforeEach } from "vitest";

const { sqlMock } = vi.hoisted(() => ({ sqlMock: vi.fn() }));
vi.mock("./index.js", () => ({ sql: sqlMock }));
vi.mock("./categories.js", () => ({ seedDefaultCategories: vi.fn() }));
vi.mock("../config.js", () => ({ config: { allowedTelegramUserIds: [] } }));

import { isActiveLedgerMember } from "./access.js";

beforeEach(() => sqlMock.mockReset());

describe("isActiveLedgerMember", () => {
  it("returns true when an active membership row exists", async () => {
    sqlMock.mockResolvedValueOnce([{ telegram_user_id: "777" }]);
    expect(await isActiveLedgerMember(-100, 777)).toBe(true);
  });

  it("returns false when no active membership row exists", async () => {
    sqlMock.mockResolvedValueOnce([]);
    expect(await isActiveLedgerMember(-100, 999)).toBe(false);
  });
});
