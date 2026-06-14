-- Migration 029: decode double-encoded confidence jsonb values.
--
-- The `confidence` column in both `expenses` and `capture_events` was written via
-- `${JSON.stringify(x)}::jsonb`. postgres.js, seeing the `::jsonb` cast, JSON-encoded
-- the already-stringified value a second time, storing a jsonb STRING node instead of
-- an object. Consumers reading `confidence.overall` got `undefined` because
-- `jsonb_typeof(confidence) = 'string'`.
--
-- The decode idiom `(confidence #>> '{}')::jsonb` extracts the inner text from
-- the jsonb string (the original JSON) and re-parses it as a real jsonb object.
-- NOTE: `::text::jsonb` would be a no-op here (re-wraps the jsonb string back
-- into a string), so we must use `#>> '{}'` to peel one layer off.

UPDATE expenses
  SET confidence = (confidence #>> '{}')::jsonb
  WHERE jsonb_typeof(confidence) = 'string';

UPDATE capture_events
  SET confidence = (confidence #>> '{}')::jsonb
  WHERE jsonb_typeof(confidence) = 'string';
