import { beforeEach, describe, expect, it, vi } from "vitest";

const sqlMock = vi.hoisted(() => vi.fn());

vi.mock("../db/index.js", () => ({
  sql: sqlMock,
}));

import { convertCents, getFxRatesForCurrencies } from "./rates.js";

describe("FX rates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    delete process.env["FX_BASE_CURRENCY"];
    delete process.env["FX_PROVIDER_URL"];
    delete process.env["FX_CACHE_TTL_HOURS"];
  });

  it("uses identity rates for the base currency", async () => {
    const fx = await getFxRatesForCurrencies(["INR"], "INR");

    expect(fx.rates).toEqual([
      {
        base_currency: "INR",
        quote_currency: "INR",
        rate: 1,
        source: "identity",
        as_of: null,
        fetched_at: null,
      },
    ]);
    expect(convertCents("12345", "INR", fx)).toBe(12345);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it("fetches and caches a live provider rate", async () => {
    sqlMock.mockResolvedValueOnce([]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ date: "2026-06-12", base: "USD", rates: { INR: 83.25 } }),
    }));
    sqlMock.mockResolvedValueOnce([]);

    const fx = await getFxRatesForCurrencies(["USD"], "INR");

    expect(fx.missing_currencies).toEqual([]);
    expect(fx.rates[0]).toMatchObject({
      base_currency: "USD",
      quote_currency: "INR",
      rate: 83.25,
      source: "frankfurter",
      as_of: "2026-06-12",
    });
    expect(convertCents(1000, "USD", fx)).toBe(83250);
  });

  it("falls back to stale cached rates when the provider fails", async () => {
    sqlMock.mockResolvedValueOnce([{
      base_currency: "USD",
      quote_currency: "INR",
      rate: "82.5000000000",
      source: "frankfurter",
      as_of: "2026-06-10",
      fetched_at: "2026-06-10T12:00:00.000Z",
      fresh: false,
    }]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));

    const fx = await getFxRatesForCurrencies(["USD"], "INR");

    expect(fx.stale).toBe(true);
    expect(fx.rates[0]?.source).toBe("stale");
    expect(convertCents(1000, "USD", fx)).toBe(82500);
  });
});
