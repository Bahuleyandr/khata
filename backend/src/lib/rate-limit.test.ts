import { describe, it, expect } from "vitest";
import { createRateLimiter } from "./rate-limit.js";

// All tests use a fake clock injected via the `now` option so there are no
// real-time waits and tests are deterministic.

describe("createRateLimiter", () => {
  it("allows calls up to the limit within the window", () => {
    let t = 1_000;
    const limiter = createRateLimiter({ limit: 3, windowMs: 60_000, now: () => t });

    expect(limiter.allow("u:1").ok).toBe(true);
    expect(limiter.allow("u:1").ok).toBe(true);
    expect(limiter.allow("u:1").ok).toBe(true);
  });

  it("blocks the call immediately after the limit is reached", () => {
    let t = 1_000;
    const limiter = createRateLimiter({ limit: 3, windowMs: 60_000, now: () => t });

    limiter.allow("u:1");
    limiter.allow("u:1");
    limiter.allow("u:1");

    const result = limiter.allow("u:1");
    expect(result.ok).toBe(false);
  });

  it("retryAfterMs is a positive value pointing to when the oldest slot reopens", () => {
    let t = 1_000;
    const limiter = createRateLimiter({ limit: 2, windowMs: 10_000, now: () => t });

    // First call at t=1000
    limiter.allow("u:1");
    // Second call at t=3000
    t = 3_000;
    limiter.allow("u:1");

    // Third call at t=5000 — blocked
    t = 5_000;
    const result = limiter.allow("u:1");
    expect(result.ok).toBe(false);
    // Oldest entry was at t=1000; window is 10000ms → slot reopens at t=11000
    // retryAfterMs should be 11000 - 5000 = 6000
    expect(result.retryAfterMs).toBe(6_000);
  });

  it("refills after windowMs has elapsed (oldest entries pruned)", () => {
    let t = 1_000;
    const limiter = createRateLimiter({ limit: 2, windowMs: 10_000, now: () => t });

    limiter.allow("u:1"); // t=1000
    limiter.allow("u:1"); // t=1000 (same tick, both in window)

    // Advance past the window for both entries
    t = 12_000;
    const result = limiter.allow("u:1");
    expect(result.ok).toBe(true);
  });

  it("isolates different keys independently", () => {
    let t = 1_000;
    const limiter = createRateLimiter({ limit: 2, windowMs: 60_000, now: () => t });

    limiter.allow("u:1");
    limiter.allow("u:1");

    // u:2 has its own bucket — should still be allowed
    expect(limiter.allow("u:2").ok).toBe(true);

    // u:1 should now be blocked
    expect(limiter.allow("u:1").ok).toBe(false);
  });

  it("prunes stale entries so the bucket does not grow unboundedly", () => {
    let t = 0;
    const WINDOW = 1_000;
    const LIMIT = 3;
    const limiter = createRateLimiter({ limit: LIMIT, windowMs: WINDOW, now: () => t });

    // Fill the window
    limiter.allow("u:1"); // t=0
    limiter.allow("u:1"); // t=0
    limiter.allow("u:1"); // t=0

    // Advance well past the window (stale entries should be pruned)
    t = 5_000;

    // Should be allowed again — all previous entries are outside the window
    expect(limiter.allow("u:1").ok).toBe(true);
    expect(limiter.allow("u:1").ok).toBe(true);
    expect(limiter.allow("u:1").ok).toBe(true);

    // Now should block again
    expect(limiter.allow("u:1").ok).toBe(false);
  });

  it("allows exactly limit calls before blocking, with sliding accuracy", () => {
    let t = 0;
    const limiter = createRateLimiter({ limit: 5, windowMs: 60_000, now: () => t });

    for (let i = 0; i < 5; i++) {
      t = i * 1_000;
      expect(limiter.allow("u:1").ok).toBe(true);
    }

    // Still within window — 6th call must be blocked
    t = 4_999;
    expect(limiter.allow("u:1").ok).toBe(false);

    // Advance so that the very first call (at t=0) falls outside the window
    t = 60_001;
    // Now there are 4 entries within [1000..60001] window; one slot opens
    expect(limiter.allow("u:1").ok).toBe(true);
  });
});
