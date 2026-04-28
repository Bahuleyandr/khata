import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sqlMock = vi.hoisted(() => vi.fn());

vi.mock("./index.js", () => ({ sql: sqlMock }));

import { findSubscriptionCandidates } from "./query.js";

describe("findSubscriptionCandidates", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-29T00:00:00.000Z"));
    sqlMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("scores stable monthly charges above noisy repeat merchants", async () => {
    sqlMock.mockResolvedValueOnce([
      {
        merchant: "MiniMax",
        total_cents: "149700",
        count: 3,
        first_seen: "2026-02-01",
        last_seen: "2026-04-01",
        avg_amount_cents: "49900",
        min_amount_cents: "49900",
        max_amount_cents: "49900",
        charge_dates: ["2026-02-01", "2026-03-01", "2026-04-01"],
      },
      {
        merchant: "Corner Store",
        total_cents: "78000",
        count: 3,
        first_seen: "2026-03-01",
        last_seen: "2026-04-23",
        avg_amount_cents: "26000",
        min_amount_cents: "12000",
        max_amount_cents: "42000",
        charge_dates: ["2026-03-01", "2026-03-08", "2026-04-23"],
      },
    ]);

    const rows = await findSubscriptionCandidates(12345, 6, 2);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      merchant: "MiniMax",
      cadence: "monthly",
      confidence: 100,
      monthly_estimate_cents: "49900",
      amount_variance_pct: 0,
    });
  });
});
