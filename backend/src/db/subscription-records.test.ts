import { describe, expect, it, vi } from "vitest";

vi.mock("./index.js", () => ({
  sql: vi.fn(),
}));

import {
  monthlyEstimateCents,
  subscriptionActivityStatus,
  summarizeSubscriptionRecords,
  type SubscriptionRecord,
} from "./subscription-records.js";

function record(overrides: Partial<SubscriptionRecord>): SubscriptionRecord {
  return {
    id: "sub-1",
    user_id: "42",
    merchant_key: "minimax",
    name: "MiniMax",
    status: "active",
    billing_cycle: "monthly",
    interval_days: null,
    anchor_dom: null,
    amount_cents: "49900",
    currency: "INR",
    category_id: null,
    category: null,
    account_id: null,
    account: null,
    payment_method: null,
    started_at: null,
    next_due_at: null,
    days_until_next: null,
    monthly_estimate_cents: "49900",
    yearly_estimate_cents: "598800",
    reminder_days: [3],
    notes: null,
    logo_url: null,
    source: "manual",
    created_at: "2026-04-28T10:00:00.000Z",
    updated_at: "2026-04-28T10:00:00.000Z",
    ...overrides,
  };
}

describe("subscription records", () => {
  it("normalizes billing cycles into monthly estimates", () => {
    expect(monthlyEstimateCents(120000, "yearly")).toBe(10000);
    expect(monthlyEstimateCents(90000, "quarterly")).toBe(30000);
    expect(monthlyEstimateCents(10000, "weekly")).toBe(43300);
    expect(monthlyEstimateCents(30000, "custom", 10)).toBe(91313);
  });

  it("summarizes active commitments and due status", () => {
    const summary = summarizeSubscriptionRecords([
      record({ monthly_estimate_cents: "49900", days_until_next: 3 }),
      record({ id: "sub-2", status: "trial", monthly_estimate_cents: "10000", days_until_next: -1 }),
      record({ id: "sub-3", status: "paused", monthly_estimate_cents: "20000", days_until_next: 1 }),
    ]);

    expect(summary.monthly_total_cents).toBe("59900");
    expect(summary.yearly_total_cents).toBe("718800");
    expect(summary.active_count).toBe(1);
    expect(summary.trial_count).toBe(1);
    expect(summary.paused_count).toBe(1);
    expect(summary.due_soon_count).toBe(1);
    expect(summary.overdue_count).toBe(1);
  });

  it("classifies subscription activity status by operational priority", () => {
    expect(subscriptionActivityStatus(record({ status: "paused" }))).toBe("inactive");
    expect(subscriptionActivityStatus(record({ days_until_next: -1 }))).toBe("overdue");
    expect(subscriptionActivityStatus(record({ days_until_next: 3 }))).toBe("due_soon");
    expect(subscriptionActivityStatus(record({ days_until_next: 20 }), { needsPriceReview: true })).toBe("price_review");
    expect(subscriptionActivityStatus(record({ next_due_at: null, days_until_next: null }))).toBe("missing_due_date");
    expect(subscriptionActivityStatus(record({ next_due_at: "2026-08-01", days_until_next: 45 }), { notSeen: true })).toBe("not_seen");
    expect(subscriptionActivityStatus(record({ next_due_at: "2026-08-01", days_until_next: 45 }))).toBe("ok");
  });
});
