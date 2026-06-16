import { describe, it, expect, vi } from "vitest";

// Mock db and config before any module that transitively loads them.
vi.mock("../db/index.js", () => ({ sql: vi.fn().mockResolvedValue([]) }));
vi.mock("../config.js", () => ({
  config: { allowedTelegramUserIds: [99999] },
}));

import { isBackupFresh, isDrillHealthy, isCaptureUnhealthy } from "./health.js";

// ─────────────────────────────────────────────────────────────────────────────
// isBackupFresh
// ─────────────────────────────────────────────────────────────────────────────

describe("isBackupFresh", () => {
  const nowMs = new Date("2026-06-16T20:00:00Z").getTime();

  it("null → false (no backup ever recorded)", () => {
    expect(isBackupFresh(null, nowMs)).toBe(false);
  });

  it("25 h ago → true (within 26 h window)", () => {
    const d = new Date(nowMs - 25 * 60 * 60 * 1000);
    expect(isBackupFresh(d, nowMs)).toBe(true);
  });

  it("exactly 26 h ago → false (age equals limit, not strictly less)", () => {
    const d = new Date(nowMs - 26 * 60 * 60 * 1000);
    expect(isBackupFresh(d, nowMs)).toBe(false);
  });

  it("27 h ago → false (stale)", () => {
    const d = new Date(nowMs - 27 * 60 * 60 * 1000);
    expect(isBackupFresh(d, nowMs)).toBe(false);
  });

  it("1 minute ago → true", () => {
    const d = new Date(nowMs - 60 * 1000);
    expect(isBackupFresh(d, nowMs)).toBe(true);
  });

  it("respects custom maxAgeHours", () => {
    const d = new Date(nowMs - 3 * 60 * 60 * 1000); // 3 h ago
    expect(isBackupFresh(d, nowMs, 2)).toBe(false);
    expect(isBackupFresh(d, nowMs, 4)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// isDrillHealthy
// ─────────────────────────────────────────────────────────────────────────────

describe("isDrillHealthy", () => {
  const nowMs = new Date("2026-06-16T20:00:00Z").getTime();

  it("null latestStatus → false", () => {
    expect(isDrillHealthy(null, new Date(nowMs - 60_000), nowMs)).toBe(false);
  });

  it("null lastPassedAt → false", () => {
    expect(isDrillHealthy("passed", null, nowMs)).toBe(false);
  });

  it("latestStatus=failed → false even with recent pass", () => {
    const recent = new Date(nowMs - 24 * 60 * 60 * 1000);
    expect(isDrillHealthy("failed", recent, nowMs)).toBe(false);
  });

  it("passed + 7 days ago → true (within 8-day window)", () => {
    const d = new Date(nowMs - 7 * 24 * 60 * 60 * 1000);
    expect(isDrillHealthy("passed", d, nowMs)).toBe(true);
  });

  it("passed + exactly 8 days ago → false (age equals limit)", () => {
    const d = new Date(nowMs - 8 * 24 * 60 * 60 * 1000);
    expect(isDrillHealthy("passed", d, nowMs)).toBe(false);
  });

  it("passed + 9 days ago → false (stale)", () => {
    const d = new Date(nowMs - 9 * 24 * 60 * 60 * 1000);
    expect(isDrillHealthy("passed", d, nowMs)).toBe(false);
  });

  it("both null → false", () => {
    expect(isDrillHealthy(null, null, nowMs)).toBe(false);
  });

  it("respects custom maxStaleDays", () => {
    const d = new Date(nowMs - 3 * 24 * 60 * 60 * 1000); // 3 days ago
    expect(isDrillHealthy("passed", d, nowMs, 2)).toBe(false);
    expect(isDrillHealthy("passed", d, nowMs, 4)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// isCaptureUnhealthy
// ─────────────────────────────────────────────────────────────────────────────

describe("isCaptureUnhealthy", () => {
  it("4 failed / 100 total → false (below abs threshold of 5)", () => {
    expect(isCaptureUnhealthy(4, 100)).toBe(false);
  });

  it("5 failed / 10 total → true (≥ abs threshold AND 50% ≥ pct threshold)", () => {
    expect(isCaptureUnhealthy(5, 10)).toBe(true);
  });

  it("6 failed / 100 total → false (meets abs but only 6% < 50% pct threshold)", () => {
    expect(isCaptureUnhealthy(6, 100)).toBe(false);
  });

  it("0 failed / 0 total → false (nothing to judge)", () => {
    expect(isCaptureUnhealthy(0, 0)).toBe(false);
  });

  it("5 failed / 0 total → false (totalCount=0 guard)", () => {
    expect(isCaptureUnhealthy(5, 0)).toBe(false);
  });

  it("10 failed / 10 total → true (100% failure rate)", () => {
    expect(isCaptureUnhealthy(10, 10)).toBe(true);
  });

  it("5 failed / 9 total → true (≈55.6% ≥ 50%)", () => {
    expect(isCaptureUnhealthy(5, 9)).toBe(true);
  });

  it("respects custom absThreshold and pctThreshold", () => {
    // Only 2 failed but custom abs=2 and custom pct=0.1 (10%)
    expect(isCaptureUnhealthy(2, 5, 2, 0.1)).toBe(true);
    // 3 failed, abs=4 → still below abs threshold
    expect(isCaptureUnhealthy(3, 5, 4, 0.1)).toBe(false);
  });
});
