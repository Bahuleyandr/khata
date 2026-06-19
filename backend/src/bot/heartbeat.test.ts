import { describe, it, expect } from "vitest";
import { livenessStatus, recordBotOk, getLastBotOkAt, BOT_STALE_MS } from "./heartbeat.js";

describe("bot heartbeat liveness (M9)", () => {
  it("is 'starting' before the first successful poll (slow-boot grace)", () => {
    expect(livenessStatus(null, 1_000_000, BOT_STALE_MS)).toBe("starting");
  });

  it("is 'ok' within the stale window", () => {
    const now = 10_000_000;
    expect(livenessStatus(now - (BOT_STALE_MS - 1), now, BOT_STALE_MS)).toBe("ok");
  });

  it("is 'stale' once the last success is older than the window", () => {
    const now = 10_000_000;
    expect(livenessStatus(now - (BOT_STALE_MS + 1), now, BOT_STALE_MS)).toBe("stale");
  });

  it("recordBotOk sets the timestamp read by getLastBotOkAt", () => {
    recordBotOk(123_456);
    expect(getLastBotOkAt()).toBe(123_456);
  });
});
