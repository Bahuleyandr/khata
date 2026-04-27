-- RAA-15: per-call Claude token usage logging

CREATE TABLE claude_usage (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  ts                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  intent                TEXT        NOT NULL
                          CHECK (intent IN ('parseExpense','classifyMessage','normalizeTransactions','receiptOCR')),
  input_tokens          INTEGER     NOT NULL DEFAULT 0,
  output_tokens         INTEGER     NOT NULL DEFAULT 0,
  cache_read_tokens     INTEGER     NOT NULL DEFAULT 0,
  cache_creation_tokens INTEGER     NOT NULL DEFAULT 0,
  model                 TEXT        NOT NULL
);

CREATE INDEX claude_usage_ts_idx ON claude_usage (ts DESC);
