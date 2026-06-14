/**
 * In-memory sliding-window rate limiter.
 *
 * Keyed by an arbitrary string (e.g. `ask:123456`, `capture:123456`).
 * Designed for a single-pod Recreate deployment — no shared state needed.
 *
 * Keying philosophy:
 *   - Bot paths: key by Telegram user id (ctx.from.id). That is the identity
 *     Telegram enforces; two household members have different Telegram ids and
 *     get independent buckets.
 *   - HTTP paths: key by session.actorUserId. The actor is the person who
 *     initiated the request (not the ledger owner), which is the right
 *     abuse-relevant identity for API rate limiting.
 */

interface LimiterOptions {
  /** Maximum calls allowed inside the sliding window. */
  limit: number;
  /** Length of the sliding window in milliseconds. */
  windowMs: number;
  /**
   * Clock function — injected so tests can fake time without touching
   * Date.now at module load. Defaults to Date.now.
   */
  now?: () => number;
}

interface AllowResult {
  /** True if the call is permitted. */
  ok: boolean;
  /**
   * When ok is false, milliseconds until the oldest call in the window
   * expires and one slot opens up.
   */
  retryAfterMs: number;
}

interface RateLimiter {
  allow(key: string): AllowResult;
}

/**
 * Create a sliding-window rate limiter.
 *
 * Each call to allow(key) records a timestamp for that key. If there are
 * already `limit` timestamps within the last `windowMs` the call is denied
 * and retryAfterMs indicates how long to wait.
 *
 * Stale entries outside the current window are pruned on every allow() call
 * for that key, so memory stays bounded to (number of active keys) *
 * (limit entries each).
 */
export function createRateLimiter(options: LimiterOptions): RateLimiter {
  const { limit, windowMs } = options;
  // Use the injected clock or a function that calls Date.now lazily (not at
  // module top-level, which would be called before tests can set up fakes).
  const now: () => number = options.now ?? (() => Date.now());

  // Map<key, sorted array of call timestamps (oldest first)>
  const store = new Map<string, number[]>();

  return {
    allow(key: string): AllowResult {
      const ts = now();
      const windowStart = ts - windowMs;

      // Retrieve or create the bucket for this key.
      let bucket = store.get(key);
      if (!bucket) {
        bucket = [];
        store.set(key, bucket);
      }

      // Prune timestamps that have fallen out of the current window.
      // The bucket is kept in insertion order (oldest first), so we can
      // splice from the front.
      let pruneCount = 0;
      while (pruneCount < bucket.length && bucket[pruneCount]! <= windowStart) {
        pruneCount++;
      }
      if (pruneCount > 0) {
        bucket.splice(0, pruneCount);
      }

      if (bucket.length >= limit) {
        // Oldest entry in the window determines when the next slot opens.
        const oldestTs = bucket[0]!;
        const retryAfterMs = oldestTs + windowMs - ts;
        return { ok: false, retryAfterMs: Math.max(0, retryAfterMs) };
      }

      // Record this call and permit it.
      bucket.push(ts);
      return { ok: true, retryAfterMs: 0 };
    },
  };
}

// ── Ready-made limiters ───────────────────────────────────────────────────────
//
// Limits are intentionally generous — this is a 2-user private bot.
// The goal is to catch runaway loops / accidental bursts, not rate-limit
// legitimate use.

/** 15 /ask LLM queries per user per minute. */
const ASK_LIMIT = 15;
const ASK_WINDOW_MS = 60_000;

/** 30 capture LLM parses per user per minute (text + photo + voice). */
const CAPTURE_LIMIT = 30;
const CAPTURE_WINDOW_MS = 60_000;

/** 10 HTTP capture replays per user per minute (dashboard replay button). */
const REPLAY_LIMIT = 10;
const REPLAY_WINDOW_MS = 60_000;

export const askLimiter: RateLimiter = createRateLimiter({
  limit: ASK_LIMIT,
  windowMs: ASK_WINDOW_MS,
});

export const captureLimiter: RateLimiter = createRateLimiter({
  limit: CAPTURE_LIMIT,
  windowMs: CAPTURE_WINDOW_MS,
});

export const replayLimiter: RateLimiter = createRateLimiter({
  limit: REPLAY_LIMIT,
  windowMs: REPLAY_WINDOW_MS,
});
