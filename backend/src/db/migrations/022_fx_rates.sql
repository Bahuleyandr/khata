-- Cached exchange rates for subscription commitment conversion.

CREATE TABLE IF NOT EXISTS fx_rates (
  base_currency  CHAR(3) NOT NULL,
  quote_currency CHAR(3) NOT NULL,
  rate           NUMERIC(20, 10) NOT NULL CHECK (rate > 0),
  source         TEXT NOT NULL DEFAULT 'frankfurter',
  as_of          DATE NOT NULL,
  fetched_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (base_currency, quote_currency)
);

CREATE INDEX IF NOT EXISTS fx_rates_fetched_idx
  ON fx_rates (fetched_at DESC);
