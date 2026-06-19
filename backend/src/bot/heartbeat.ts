/**
 * Bot liveness heartbeat (audit 2026-06-19 M9).
 *
 * The long-poll loop can wedge (lose its Telegram connection) while the process
 * and DB stay healthy, so a DB-only `/health` would keep reporting OK while the
 * bot silently drops every message. A periodic `getMe()` heartbeat records the
 * last time the bot could reach Telegram; the `/live` endpoint (wired to the
 * k8s *liveness* probe — readiness stays DB-only) reports "stale" once that is
 * too old, so k8s restarts the pod and recovers the poller.
 *
 * `getMe` succeeding does not prove the poll loop is processing updates, but a
 * sustained getMe FAILURE is a genuine "can't reach Telegram" wedge — the case
 * worth restarting for — without the false positives of update-freshness on a
 * low-traffic bot (no messages != wedged).
 */
export const BOT_HEARTBEAT_MS = 60_000;
export const BOT_STALE_MS = 5 * 60_000;

export type BotLiveness = "starting" | "ok" | "stale";

let lastBotOkAt: number | null = null;

export function recordBotOk(now: number = Date.now()): void {
  lastBotOkAt = now;
}

export function getLastBotOkAt(): number | null {
  return lastBotOkAt;
}

/** Pure decision used by `/live`. Before the first successful poll it is
 *  "starting" (a grace state that must NOT fail liveness on a slow boot). */
export function livenessStatus(
  lastOkAt: number | null,
  now: number,
  staleMs: number = BOT_STALE_MS,
): BotLiveness {
  if (lastOkAt === null) return "starting";
  return now - lastOkAt > staleMs ? "stale" : "ok";
}

/**
 * Poll `getMe` every `intervalMs` and record success. Returns a stop function
 * (clear the interval on shutdown). Runs one tick immediately so a healthy bot
 * leaves "starting" quickly.
 */
export function startBotHeartbeat(
  getMe: () => Promise<unknown>,
  onError: (err: unknown) => void,
  intervalMs: number = BOT_HEARTBEAT_MS,
): () => void {
  const tick = async (): Promise<void> => {
    try {
      await getMe();
      recordBotOk();
    } catch (err) {
      onError(err);
    }
  };
  void tick();
  const handle = setInterval(() => void tick(), intervalMs);
  return () => clearInterval(handle);
}
