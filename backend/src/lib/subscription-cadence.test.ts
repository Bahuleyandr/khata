import { describe, it, expect } from "vitest";
import { advanceNextDueAt, advanceUntilFuture } from "./subscription-cadence.js";

// ── advanceNextDueAt ──────────────────────────────────────────────────────────

describe("advanceNextDueAt — weekly", () => {
  it("advances by exactly 7 days", () => {
    expect(advanceNextDueAt("2026-01-01", "weekly", null, null)).toBe("2026-01-08");
  });
  it("crosses month boundary correctly", () => {
    expect(advanceNextDueAt("2026-01-29", "weekly", null, null)).toBe("2026-02-05");
  });
});

describe("advanceNextDueAt — fortnightly", () => {
  it("advances by exactly 14 days", () => {
    expect(advanceNextDueAt("2026-03-10", "fortnightly", null, null)).toBe("2026-03-24");
  });
});

describe("advanceNextDueAt — monthly", () => {
  it("Jan 31 → Feb 28 (clamp to last day of Feb)", () => {
    expect(advanceNextDueAt("2026-01-31", "monthly", null, null)).toBe("2026-02-28");
  });
  it("Feb 28 with anchor 31 → Mar 31 (restore from anchor)", () => {
    expect(advanceNextDueAt("2026-02-28", "monthly", null, 31)).toBe("2026-03-31");
  });
  it("Feb 28 with anchor 31 → Mar 31 even when currentDOM = 28", () => {
    // anchor_dom drives the restoration, not the clamped value
    expect(advanceNextDueAt("2026-02-28", "monthly", null, 31)).toBe("2026-03-31");
  });
  it("Dec 31 → Jan 31 next year", () => {
    expect(advanceNextDueAt("2026-12-31", "monthly", null, null)).toBe("2027-01-31");
  });
  it("Mar 31 with anchor 31 → Apr 30 (April only has 30 days)", () => {
    expect(advanceNextDueAt("2026-03-31", "monthly", null, 31)).toBe("2026-04-30");
  });
  it("normal day stays the same DOM", () => {
    expect(advanceNextDueAt("2026-03-15", "monthly", null, 15)).toBe("2026-04-15");
  });
});

describe("advanceNextDueAt — quarterly", () => {
  it("Jan 31 → Apr 30 (April has 30 days)", () => {
    expect(advanceNextDueAt("2026-01-31", "quarterly", null, 31)).toBe("2026-04-30");
  });
  it("Oct 31 → Jan 31 next year", () => {
    expect(advanceNextDueAt("2026-10-31", "quarterly", null, 31)).toBe("2027-01-31");
  });
  it("normal mid-month", () => {
    expect(advanceNextDueAt("2026-02-15", "quarterly", null, 15)).toBe("2026-05-15");
  });
});

describe("advanceNextDueAt — yearly", () => {
  it("Feb 29 leap → Feb 28 non-leap year", () => {
    // 2024-02-29 + 1 year = 2025-02-28 (2025 is not a leap year)
    expect(advanceNextDueAt("2024-02-29", "yearly", null, 29)).toBe("2025-02-28");
  });
  it("Feb 28 with anchor 29 → Feb 28 non-leap stays clamped", () => {
    expect(advanceNextDueAt("2025-02-28", "yearly", null, 29)).toBe("2026-02-28");
  });
  it("Feb 28 with anchor 29 → Feb 29 leap year", () => {
    // 2027-02-28 + 1 year → 2028-02-29 (2028 IS a leap year)
    expect(advanceNextDueAt("2027-02-28", "yearly", null, 29)).toBe("2028-02-29");
  });
  it("normal date advances by 12 months", () => {
    expect(advanceNextDueAt("2026-06-14", "yearly", null, 14)).toBe("2027-06-14");
  });
});

describe("advanceNextDueAt — custom", () => {
  it("adds intervalDays", () => {
    expect(advanceNextDueAt("2026-03-01", "custom", 10, null)).toBe("2026-03-11");
  });
  it("null intervalDays → returns currentDueAt unchanged (no-op)", () => {
    expect(advanceNextDueAt("2026-03-01", "custom", null, null)).toBe("2026-03-01");
  });
});

// ── advanceUntilFuture ────────────────────────────────────────────────────────

describe("advanceUntilFuture", () => {
  it("single advance when one step puts it past today", () => {
    // today = 2026-06-14; next_due = 2026-06-10 (4 days overdue); weekly → 2026-06-17
    const result = advanceUntilFuture("2026-06-10", "weekly", null, null, "2026-06-14");
    expect(result).toBe("2026-06-17");
    expect(result > "2026-06-14").toBe(true);
  });

  it("multi-cycle catch-up (monthly, many months behind)", () => {
    // 2025-01-31 monthly, today 2026-06-14 → needs ~17 advances to clear today
    const result = advanceUntilFuture("2025-01-31", "monthly", null, 31, "2026-06-14");
    expect(result > "2026-06-14").toBe(true);
    // Should land on 2026-06-30 (June has 30, anchor=31)
    expect(result).toBe("2026-06-30");
  });

  it("already future → unchanged", () => {
    const result = advanceUntilFuture("2026-06-20", "weekly", null, null, "2026-06-14");
    expect(result).toBe("2026-06-20");
  });

  it("exactly on today → advances once (must be strictly > today)", () => {
    const result = advanceUntilFuture("2026-06-14", "weekly", null, null, "2026-06-14");
    expect(result).toBe("2026-06-21");
    expect(result > "2026-06-14").toBe(true);
  });

  it("custom null intervalDays → no-op (safety: returns unchanged)", () => {
    const result = advanceUntilFuture("2026-01-01", "custom", null, null, "2026-06-14");
    expect(result).toBe("2026-01-01");
  });

  it("fortnightly catch-up", () => {
    // 3 advances: 2026-05-01 → 2026-05-15 → 2026-05-29 → 2026-06-12 → 2026-06-26 (first > 2026-06-14)
    const result = advanceUntilFuture("2026-05-01", "fortnightly", null, null, "2026-06-14");
    expect(result).toBe("2026-06-26");
  });
});
