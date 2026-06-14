-- Migration 030: decode remaining double-encoded jsonb columns.
--
-- Several columns were written via `${JSON.stringify(x)}::jsonb`. postgres.js,
-- seeing the `::jsonb` cast, JSON-encoded the already-stringified value a second
-- time, storing a jsonb STRING node instead of an object. Consumers reading
-- `.field` on the returned object got `undefined`.
--
-- Fixed columns and their write sites:
--   audit_log.before   / audit_log.after / audit_log.metadata  — db/audit.ts undoAuditEvent
--   capture_events.metadata                                     — db/captures.ts recordCaptureEvent
--   capture_events.diagnosis                                    — db/captures.ts markCaptureFailed
--   monthly_closes.snapshot                                     — db/monthly-closes.ts markMonthlyCloseExported, closeMonthlyPeriod
--   insights.payload                                            — insights/compute.ts computeAndStoreInsightsForUser
--
-- The decode idiom `(col #>> '{}')::jsonb` extracts the inner text from the
-- jsonb string node (the original JSON text) and re-parses it as a real jsonb
-- object. Only rows where jsonb_typeof(col) = 'string' are affected.
-- NULL columns are unaffected: jsonb_typeof(NULL) returns NULL, so the WHERE
-- clause naturally excludes them.
--
-- Safety checks:
--   audit_log.before / .after: always NULL or an object snapshot of an entity
--     record — never a legitimate scalar string.
--   audit_log.metadata: always an object (Record<string,unknown>), default '{}'.
--   capture_events.metadata: always an object (Record<string,unknown>), default '{}'.
--   capture_events.diagnosis: always an object (CaptureFailureDiagnosis shape), default '{}'.
--   monthly_closes.snapshot: always an object (Record<string,unknown>), default '{}'.
--   insights.payload: always an object (MtdVsLastMonthPayload | TopMerchantsMtdPayload |
--     RecurringPayload) — never a legitimate scalar string.
--
-- Note: `confidence` on expenses and capture_events was already decoded by
-- migration 029; do NOT re-touch those columns here.

UPDATE audit_log
  SET before = (before #>> '{}')::jsonb
  WHERE jsonb_typeof(before) = 'string';

UPDATE audit_log
  SET after = (after #>> '{}')::jsonb
  WHERE jsonb_typeof(after) = 'string';

UPDATE audit_log
  SET metadata = (metadata #>> '{}')::jsonb
  WHERE jsonb_typeof(metadata) = 'string';

UPDATE capture_events
  SET metadata = (metadata #>> '{}')::jsonb
  WHERE jsonb_typeof(metadata) = 'string';

UPDATE capture_events
  SET diagnosis = (diagnosis #>> '{}')::jsonb
  WHERE jsonb_typeof(diagnosis) = 'string';

UPDATE monthly_closes
  SET snapshot = (snapshot #>> '{}')::jsonb
  WHERE jsonb_typeof(snapshot) = 'string';

UPDATE insights
  SET payload = (payload #>> '{}')::jsonb
  WHERE jsonb_typeof(payload) = 'string';
