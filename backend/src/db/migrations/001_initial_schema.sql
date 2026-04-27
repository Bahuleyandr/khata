-- Categories (must come first — expenses references it)
CREATE TABLE IF NOT EXISTS categories (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      BIGINT NOT NULL,
  name         TEXT NOT NULL,
  is_default   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, name)
);

-- Statements (imported bank/card PDF statements)
CREATE TABLE IF NOT EXISTS statements (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      BIGINT NOT NULL,
  file_key     TEXT NOT NULL,       -- S3 object key
  status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'processing', 'done', 'error')),
  parsed_count INT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Expenses
CREATE TABLE IF NOT EXISTS expenses (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       BIGINT NOT NULL,
  amount_cents  BIGINT NOT NULL,
  currency      CHAR(3) NOT NULL DEFAULT 'INR',
  description   TEXT,
  merchant      TEXT,
  category_id   UUID REFERENCES categories(id) ON DELETE SET NULL,
  occurred_at   TIMESTAMPTZ NOT NULL,
  source        TEXT NOT NULL DEFAULT 'manual'
                  CHECK (source IN ('manual', 'telegram', 'statement')),
  raw_text      TEXT,
  statement_id  UUID REFERENCES statements(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS expenses_user_occurred ON expenses (user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS expenses_category ON expenses (category_id);
CREATE INDEX IF NOT EXISTS statements_user ON statements (user_id);
