import { sql } from "../db/index.js";

export interface FxRate {
  base_currency: string;
  quote_currency: string;
  rate: number;
  source: "identity" | "frankfurter" | "cached" | "stale";
  as_of: string | null;
  fetched_at: string | null;
}

export interface FxConversionSummary {
  base_currency: string;
  source: "frankfurter";
  rates: FxRate[];
  missing_currencies: string[];
  stale: boolean;
  fetched_at: string | null;
}

type FxRateRow = {
  base_currency: string;
  quote_currency: string;
  rate: string;
  source: string;
  as_of: string;
  fetched_at: string;
  fresh: boolean;
};

type FrankfurterResponse = {
  date?: string;
  base?: string;
  rates?: Record<string, number>;
};

const DEFAULT_BASE = "INR";
const DEFAULT_PROVIDER_URL = "https://api.frankfurter.dev/v2/rates";
const DEFAULT_TTL_HOURS = 18;

function normalizeCurrency(value: string): string {
  return value.trim().toUpperCase().slice(0, 3);
}

function fxBaseCurrency(): string {
  return normalizeCurrency(process.env["FX_BASE_CURRENCY"] ?? DEFAULT_BASE) || DEFAULT_BASE;
}

function fxProviderUrl(): string {
  return process.env["FX_PROVIDER_URL"] ?? DEFAULT_PROVIDER_URL;
}

function fxTtlHours(): number {
  const parsed = Number(process.env["FX_CACHE_TTL_HOURS"] ?? DEFAULT_TTL_HOURS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TTL_HOURS;
}

async function readCachedRate(fromCurrency: string, toCurrency: string): Promise<FxRateRow | null> {
  const [row] = await sql<FxRateRow[]>`
    SELECT base_currency,
           quote_currency,
           rate::text AS rate,
           source,
           as_of::date::text AS as_of,
           fetched_at::text AS fetched_at,
           fetched_at >= NOW() - (${fxTtlHours()} || ' hours')::interval AS fresh
    FROM fx_rates
    WHERE base_currency = ${fromCurrency}
      AND quote_currency = ${toCurrency}
    LIMIT 1
  `;
  return row ?? null;
}

async function fetchLiveRate(fromCurrency: string, toCurrency: string): Promise<FxRate | null> {
  const url = new URL(fxProviderUrl());
  url.searchParams.set("base", fromCurrency);
  url.searchParams.set("quotes", toCurrency);
  const response = await fetch(url, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) return null;
  const payload = (await response.json()) as FrankfurterResponse;
  const rawRate = payload.rates?.[toCurrency];
  if (typeof rawRate !== "number" || !Number.isFinite(rawRate) || !payload.date) return null;
  const rate = rawRate;

  await sql`
    INSERT INTO fx_rates (base_currency, quote_currency, rate, source, as_of, fetched_at)
    VALUES (${fromCurrency}, ${toCurrency}, ${rate}, 'frankfurter', ${payload.date}, NOW())
    ON CONFLICT (base_currency, quote_currency)
    DO UPDATE SET
      rate = EXCLUDED.rate,
      source = EXCLUDED.source,
      as_of = EXCLUDED.as_of,
      fetched_at = NOW()
  `;

  return {
    base_currency: fromCurrency,
    quote_currency: toCurrency,
    rate,
    source: "frankfurter",
    as_of: payload.date,
    fetched_at: new Date().toISOString(),
  };
}

async function resolveRate(fromCurrency: string, toCurrency: string): Promise<FxRate | null> {
  if (fromCurrency === toCurrency) {
    return {
      base_currency: fromCurrency,
      quote_currency: toCurrency,
      rate: 1,
      source: "identity",
      as_of: null,
      fetched_at: null,
    };
  }

  const cached = await readCachedRate(fromCurrency, toCurrency);
  if (cached?.fresh) {
    return {
      base_currency: fromCurrency,
      quote_currency: toCurrency,
      rate: Number(cached.rate),
      source: "cached",
      as_of: cached.as_of,
      fetched_at: cached.fetched_at,
    };
  }

  try {
    const live = await fetchLiveRate(fromCurrency, toCurrency);
    if (live) return live;
  } catch (error) {
    console.warn(`FX fetch failed for ${fromCurrency}->${toCurrency}:`, error);
  }

  if (cached) {
    return {
      base_currency: fromCurrency,
      quote_currency: toCurrency,
      rate: Number(cached.rate),
      source: "stale",
      as_of: cached.as_of,
      fetched_at: cached.fetched_at,
    };
  }

  return null;
}

export function configuredFxBaseCurrency(): string {
  return fxBaseCurrency();
}

export async function getFxRatesForCurrencies(
  currencies: string[],
  targetCurrency: string = fxBaseCurrency(),
): Promise<FxConversionSummary> {
  const base = normalizeCurrency(targetCurrency) || DEFAULT_BASE;
  const uniqueCurrencies = Array.from(
    new Set(currencies.map(normalizeCurrency).filter((currency) => currency.length === 3)),
  );

  const rates: FxRate[] = [];
  const missing: string[] = [];
  for (const currency of uniqueCurrencies) {
    const rate = await resolveRate(currency, base);
    if (rate) rates.push(rate);
    else missing.push(currency);
  }

  const nonIdentity = rates.filter((rate) => rate.source !== "identity");
  const fetchedAt = nonIdentity
    .map((rate) => rate.fetched_at)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;

  return {
    base_currency: base,
    source: "frankfurter",
    rates,
    missing_currencies: missing,
    stale: rates.some((rate) => rate.source === "stale"),
    fetched_at: fetchedAt,
  };
}

export function convertCents(amountCents: string | number, fromCurrency: string, fx: FxConversionSummary): number | null {
  const currency = normalizeCurrency(fromCurrency);
  const rate = fx.rates.find((entry) => entry.base_currency === currency && entry.quote_currency === fx.base_currency);
  if (!rate) return null;
  return Math.round(Number(amountCents) * rate.rate);
}
